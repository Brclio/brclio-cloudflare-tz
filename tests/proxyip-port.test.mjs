// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Real workerd -> ProxyIP -> local HTTP round trips after a refused direct
// connection. The wrapper observes/readdresses sockets; only real local servers
// produce destination responses. No request can reach an external service.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('..', import.meta.url));
const uuid = '00000000-0000-4000-8000-000000000001';
const origin = 'https://proxyip-port.example.com';
const target = 'cp.cloudflare.com';
const proxyAddress = '192.0.2.44';
const sockets = new Set();
const requests = [];
const tlsBytes = [];
const unexpectedFetches = [];
const dnsRequests = [];
let mf, httpServer, securePortFixture, httpPort, securePort;
let connectionID = 0, requestID = 0;

const wrapper = `
import worker from './dist/_worker.js';
import { connect } from 'cloudflare:sockets';
const dials = [], blocked = [];
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/__fixture/state') return Response.json({ dials, blocked });
    const id = request.headers.get('x-fixture-id');
    const scoped = { ...env, PROXYIP: request.headers.get('x-fixture-proxyip') };
    Object.defineProperty(request, 'cf', { value: { colo: 'TEST', country: 'XX', asn: 0 } });
    Object.defineProperty(request, 'fetcher', { value: {
      connect(options, init) {
        const hostname = String(options.hostname), port = Number(options.port);
        if (hostname === 'cp.cloudflare.com' && [80, 443, 8443].includes(port)) {
          dials.push({ id, hostname, port, direct: true });
          throw new Error('Direct destination refused by local fixture; use ProxyIP');
        }
        if (!['192.0.2.44', '[2001:db8::44]'].includes(hostname) || ![80, 443].includes(port)) {
          blocked.push({ id, hostname, port });
          throw new Error('External TCP blocked by local ProxyIP fixture');
        }
        dials.push({ id, hostname, port, direct: false });
        return connect({ hostname: '127.0.0.1', port: Number(port === 80 ? env.FIXTURE_HTTP_PORT : env.FIXTURE_SECURE_PORT) }, init);
      }
    } });
    return worker.fetch(request, scoped, ctx);
  }
};
`;

function own(socket) {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  socket.fixtureConnection = ++connectionID;
  return socket;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

function receivedRequest(socket, logicalPort, method, path, host, tag) {
  const entry = { connection: socket.fixtureConnection, logicalPort, method, path, host, tag, nonce: randomUUID() };
  requests.push(entry);
  return entry;
}

// Production DoH uses RFC 1035 binary messages. Keep its real parser active by
// replying with a minimal authoritative local fixture, including TXT lengths.
async function dnsResponse(request) {
  if (request.url !== 'https://cloudflare-dns.com/dns-query' || request.method !== 'POST') {
    unexpectedFetches.push(request.url);
    return new Response('External fetch blocked', { status: 599 });
  }
  const query = Buffer.from(await request.arrayBuffer());
  let offset = 12;
  const labels = [];
  while (query[offset]) {
    const length = query[offset++];
    labels.push(query.subarray(offset, offset + length).toString());
    offset += length;
  }
  offset++;
  const name = labels.join('.'), type = query.readUInt16BE(offset);
  const allowed = ['a.proxy.fixture', 'txt.proxy.fixture', 'explicit-txt.proxy.fixture', 'a.tp443.proxy.fixture', 'stall-txt.proxy.fixture'];
  if (!allowed.includes(name)) {
    unexpectedFetches.push(`${request.url} ${name} ${type}`);
    return new Response('Unknown DNS fixture', { status: 599 });
  }
  dnsRequests.push({ name, type });
  if (name === 'stall-txt.proxy.fixture' && type === 16) {
    // Headers arrive but the DNS body never completes. The production timeout
    // must cancel body consumption and allow the parallel A answer to be used.
    return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/dns-message' } });
  }
  let data;
  if (type === 1 && ['a.proxy.fixture', 'a.tp443.proxy.fixture', 'stall-txt.proxy.fixture'].includes(name)) data = Buffer.from([192, 0, 2, 44]);
  if (type === 16 && name.includes('txt.')) {
    const text = Buffer.from(name === 'explicit-txt.proxy.fixture' ? `${proxyAddress}:443` : proxyAddress);
    data = Buffer.concat([Buffer.from([text.length]), text]);
  }
  const header = Buffer.from(query.subarray(0, 12));
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(data ? 1 : 0, 6);
  const parts = [header, query.subarray(12)];
  if (data) {
    const record = Buffer.alloc(12);
    record.writeUInt16BE(0xc00c, 0);
    record.writeUInt16BE(type, 2);
    record.writeUInt16BE(1, 4);
    record.writeUInt32BE(300, 6);
    record.writeUInt16BE(data.length, 10);
    parts.push(record, data);
  }
  return new Response(Buffer.concat(parts), { headers: { 'Content-Type': 'application/dns-message' } });
}

before(async () => {
  httpServer = http.createServer((request, response) => {
    const entry = receivedRequest(request.socket, 80, request.method, request.url, request.headers.host, request.headers['x-fixture-request']);
    response.writeHead(204, {
      'X-Fixture-Nonce': entry.nonce,
      'X-Fixture-Connection': String(entry.connection),
      'Content-Length': '0',
      Connection: 'keep-alive',
    });
    response.end();
  });
  httpServer.on('connection', own);
  httpPort = await listen(httpServer);

  // A logical HTTPS-port fixture echoes TLS records, but responds HTTP 400 to
  // plaintext HEAD. This catches the original HTTP:80 -> ProxyIP:443 mistake
  // without introducing a fake 204 inside the Worker or connector wrapper.
  securePortFixture = net.createServer(socket => {
    own(socket);
    let pending = Buffer.alloc(0), tls = false;
    socket.on('data', chunk => {
      if (tls || (!pending.length && chunk[0] === 0x16)) {
        tls = true;
        tlsBytes.push(Buffer.from(chunk));
        socket.write(chunk);
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      for (let end; (end = pending.indexOf('\r\n\r\n')) >= 0;) {
        const lines = pending.subarray(0, end).toString().split('\r\n');
        pending = pending.subarray(end + 4);
        const [method, path] = lines.shift().split(' ');
        const headers = Object.fromEntries(lines.map(line => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        }));
        const entry = receivedRequest(socket, 443, method, path, headers.host, headers['x-fixture-request']);
        socket.write(`HTTP/1.1 400 Plain HTTP on HTTPS port\r\nX-Fixture-Nonce: ${entry.nonce}\r\nX-Fixture-Connection: ${entry.connection}\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n`);
      }
    });
  });
  securePort = await listen(securePortFixture);
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: root,
    modules: [
      { type: 'ESModule', path: `${root}/proxyip-port-fixture.mjs`, contents: wrapper },
      { type: 'ESModule', path: `${root}/dist/_worker.js` },
    ],
    compatibilityDate: '2025-11-04', cf: false,
    bindings: {
      ADMIN: 'local-proxyip-port-password', UUID: uuid, OFF_LOG: 'true',
      TCP_CONCURRENT_DIAL: '1', PROXY_CONCURRENT_DIAL: '1',
      FIXTURE_HTTP_PORT: String(httpPort), FIXTURE_SECURE_PORT: String(securePort),
    },
    outboundService: dnsResponse,
  }));
  await mf.ready;
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  if (mf) await mf.dispose();
  await Promise.all([httpServer, securePortFixture].filter(server => server?.listening)
    .map(server => new Promise(resolve => server.close(resolve))));
  assert.deepEqual(unexpectedFetches, [], 'All external fetches must terminate at the approved local DoH fixture');
});

function handshake(port, payload) {
  const hostname = Buffer.from(target);
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, port >> 8, port & 255, 2, hostname.length]), hostname, payload]);
}

async function open(proxyIP) {
  const id = `proxyip-${++requestID}`;
  const response = await mf.dispatchFetch(`${origin}/tunnel`, {
    headers: { Upgrade: 'websocket', 'x-fixture-id': id, 'x-fixture-proxyip': proxyIP },
  });
  assert.equal(response.status, 101);
  response.webSocket.accept();
  return { id, ws: response.webSocket };
}

function readWS(ws, completed, send) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const finish = error => {
      clearTimeout(timer);
      ws.removeEventListener('message', message);
      ws.removeEventListener('close', closed);
      ws.removeEventListener('error', errored);
      if (error) reject(error); else resolve(pending);
    };
    const message = event => {
      pending = Buffer.concat([pending, Buffer.from(event.data)]);
      if (completed(pending)) finish();
    };
    const closed = () => finish(new Error('WebSocket closed before destination reply'));
    const errored = () => finish(new Error('WebSocket reported an error'));
    const timer = setTimeout(() => finish(new Error('ProxyIP destination reply timed out')), 5000);
    ws.addEventListener('message', message);
    ws.addEventListener('close', closed);
    ws.addEventListener('error', errored);
    try { send(); } catch (error) { finish(error); }
  });
}

async function assertDials(id, targetPort, fallbackPort) {
  const response = await mf.dispatchFetch(`${origin}/__fixture/state`);
  const { dials, blocked } = await response.json();
  assert.deepEqual(blocked, [], 'TCP must stay inside approved fixture destinations');
  const actual = dials.filter(dial => dial.id === id);
  assert.equal(actual.length, 2, 'Only one refused direct attempt and one reused ProxyIP socket');
  assert.deepEqual(actual.map(({ port, direct }) => ({ port, direct })), [
    { port: targetPort, direct: true }, { port: fallbackPort, direct: false },
  ]);
}

async function headTwice(proxyIP, expectedPort) {
  const { id, ws } = await open(proxyIP);
  const replies = [];
  try {
    for (let sequence = 1; sequence <= 2; sequence++) {
      const tag = `${id}/${sequence}`;
      const request = Buffer.from(`HEAD /generate_204?sequence=${sequence} HTTP/1.1\r\nHost: ${target}\r\nX-Fixture-Request: ${tag}\r\nConnection: keep-alive\r\n\r\n`);
      const wire = await readWS(ws, bytes => bytes.includes('\r\n\r\n'), () => ws.send(sequence === 1 ? handshake(80, request) : request));
      if (sequence === 1) assert.deepEqual(wire.subarray(0, 2), Buffer.from([0, 0]));
      const text = wire.subarray(sequence === 1 ? 2 : 0).toString();
      assert.match(text, expectedPort === 80 ? /^HTTP\/1\.1 204 / : /^HTTP\/1\.1 400 /);
      const entry = requests.find(item => item.tag === tag);
      assert.ok(entry, 'The actual local destination must receive this HEAD request');
      assert.equal(entry.logicalPort, expectedPort);
      assert.equal(entry.method, 'HEAD');
      assert.equal(entry.host, target);
      assert.ok(text.includes(entry.nonce), 'Response must contain the destination-generated random nonce');
      assert.match(text, /connection: keep-alive/i);
      replies.push(entry);
    }
    assert.equal(replies[0].connection, replies[1].connection, 'Both HEAD requests reuse the same actual ProxyIP socket');
    await assertDials(id, 80, expectedPort);
  } finally { try { ws.close(); } catch {} }
}

for (const [label, proxyIP] of [
  ['bare IPv4', proxyAddress],
  ['bare IPv6', '[2001:db8::44]'],
  ['domain with A records', 'a.proxy.fixture'],
  ['TXT entry without a port', 'txt.proxy.fixture'],
]) {
  test(`HTTP port 80 fallback uses port 80 for ${label} and returns two real keep-alive 204 replies`, { timeout: 10000 }, async () => {
    await headTwice(proxyIP, 80);
  });
}

for (const [label, proxyIP] of [
  ['explicit IPv4 port', `${proxyAddress}:443`],
  ['explicit domain port', 'a.proxy.fixture:443'],
  ['explicit parent-domain port inherited by a bare TXT entry', 'txt.proxy.fixture:443'],
  ['explicit TXT-entry port', 'explicit-txt.proxy.fixture'],
  ['explicit TXT-entry port overriding its parent port 80', 'explicit-txt.proxy.fixture:80'],
  ['.tp443 domain', 'a.tp443.proxy.fixture'],
]) {
  test(`HTTP target preserves ${label} 443 instead of silently rewriting user configuration`, { timeout: 10000 }, async () => {
    await headTwice(proxyIP, 443);
  });
}

for (const targetPort of [443, 8443]) {
  test(`target port ${targetPort} retains the existing default ProxyIP port 443 and forwards TLS bytes`, { timeout: 10000 }, async () => {
    const { id, ws } = await open(proxyAddress);
    // Transparent TLS-record forwarding, not a full TLS handshake claim.
    const payload = Buffer.from('1603010034010000300303' + '11'.repeat(32) + '000002130101000005000b000100', 'hex');
    const before = tlsBytes.length;
    try {
      const response = await readWS(ws, bytes => bytes.length >= payload.length + 2, () => ws.send(handshake(targetPort, payload)));
      assert.deepEqual(response, Buffer.concat([Buffer.from([0, 0]), payload]));
      assert.deepEqual(Buffer.concat(tlsBytes.slice(before)), payload, 'Destination receives the exact TLS record');
      await assertDials(id, targetPort, 443);
    } finally { try { ws.close(); } catch {} }
  });
}

test('a stalled TXT response body cannot block a healthy parallel A-record fallback indefinitely', { timeout: 10000 }, async () => {
  const start = Date.now();
  await headTwice('stall-txt.proxy.fixture', 80);
  assert.ok(Date.now() - start < 7000, 'The production DoH deadline must bound the lookup before HTTP forwarding');
});
