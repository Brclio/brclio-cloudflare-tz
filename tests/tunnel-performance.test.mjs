// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Exercise the unchanged production bundle in workerd. Only the test entrypoint
// injects observable KV, request metadata and a connector fenced to loopback.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('..', import.meta.url));
const uuid = '00000000-0000-4000-8000-000000000001';
const origin = 'https://performance.example.com';
const target = 'fixture.example.com';
const sockets = new Set();
const outgoing = [];
const received = [];
const proxyTargets = [];
const kvGates = new Map();
let mf, directServer, proxyServer, directPort, proxyPort;
let nextID = 0;

// This wrapper is a separate ES module, not a source rewrite. Each request gets
// its own environment and connector; all production parsers and stream pumps run.
const wrapper = `
import worker from './dist/_worker.js';
import { connect } from 'cloudflare:sockets';
const reads = [], dials = [], blocked = [];
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__fixture/state') return Response.json({ reads, dials, blocked });
    const id = request.headers.get('x-fixture-id');
    const entries = JSON.parse(request.headers.get('x-fixture-whitelist') || '[]');
    const scoped = { ...env, KV: {
      async get(key) {
        reads.push({ id, key });
        if (request.headers.get('x-fixture-block-kv') === '1') {
          await env.FIXTURE_KV_GATE.fetch('https://kv-fixture.invalid/?id=' + encodeURIComponent(id));
        }
        return JSON.stringify({ 反代: { SOCKS5: { 白名单: entries } } });
      }
    } };
    for (const name of ['TCP_CONCURRENT_DIAL', 'PROXY_CONCURRENT_DIAL']) {
      const value = request.headers.get('x-fixture-' + name.toLowerCase().replaceAll('_', '-'));
      if (value !== null) scoped[name] = value;
    }
    Object.defineProperty(request, 'cf', { value: {
      colo: 'TEST', country: request.headers.get('x-fixture-mobile') === '1' ? 'CN' : 'XX',
      asn: request.headers.get('x-fixture-mobile') === '1' ? 9808 : 0,
    } });
    Object.defineProperty(request, 'fetcher', { value: {
      connect(options, init) {
        const hostname = String(options.hostname), port = Number(options.port);
        const proxy = hostname === '127.0.0.1' && port === Number(env.FIXTURE_PROXY_PORT);
        const direct = ['fixture.example.com', 'speed.cloudflare.com', 'cp.cloudflare.com'].includes(hostname)
          && [80, 443].includes(port);
        if (!proxy && !direct) {
          blocked.push({ id, hostname, port });
          throw new Error('External TCP blocked by local performance fixture');
        }
        dials.push({ id, hostname, port, proxy });
        return connect({ hostname: '127.0.0.1', port: proxy ? Number(env.FIXTURE_PROXY_PORT) : Number(env.FIXTURE_DIRECT_PORT) }, init);
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
  return socket;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

before(async () => {
  directServer = net.createServer(socket => {
    own(socket).on('data', data => received.push(Buffer.from(data)));
    socket.pipe(socket);
  });
  directPort = await listen(directServer);
  proxyServer = net.createServer(socket => {
    own(socket);
    let pending = Buffer.alloc(0);
    const parse = chunk => {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      const match = /^CONNECT ([^ ]+) HTTP\/1\.1\r\n/.exec(pending.toString());
      if (!match || match[1] !== `${target}:443`) return socket.destroy();
      proxyTargets.push(match[1]);
      socket.removeListener('data', parse);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const extra = pending.subarray(end + 4);
      if (extra.length) socket.write(extra);
      socket.pipe(socket);
    };
    socket.on('data', parse);
  });
  proxyPort = await listen(proxyServer);
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: root,
    modules: [
      { type: 'ESModule', path: `${root}/performance-fixture.mjs`, contents: wrapper },
      { type: 'ESModule', path: `${root}/dist/_worker.js` },
    ],
    compatibilityDate: '2025-11-04', cf: false,
    bindings: {
      ADMIN: 'local-performance-test-password', UUID: uuid, OFF_LOG: 'true',
      PROXYIP: `127.0.0.1:${proxyPort}`,
      FIXTURE_DIRECT_PORT: String(directPort), FIXTURE_PROXY_PORT: String(proxyPort),
    },
    // Pending service I/O keeps the workerd request alive just like real KV.
    // A bare unresolved JS Promise would trigger workerd's deadlock detector.
    serviceBindings: {
      FIXTURE_KV_GATE: request => new Promise(resolve => {
        kvGates.set(new URL(request.url).searchParams.get('id'), () => resolve(new Response('released')));
      }),
    },
    outboundService: request => {
      outgoing.push(request.url);
      return new Response('External fetch blocked by local performance fixture', { status: 599 });
    },
  }));
  await mf.ready;
});

after(async () => {
  for (const resolve of kvGates.values()) resolve();
  for (const socket of sockets) socket.destroy();
  if (mf) await mf.dispose();
  await Promise.all([directServer, proxyServer].filter(server => server?.listening)
    .map(server => new Promise(resolve => server.close(resolve))));
  assert.deepEqual(outgoing, [], 'No application HTTP request may leave the local fixture');
});

function deadline(promise, label, ms = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  })]).finally(() => clearTimeout(timer));
}

async function state(id) {
  const response = await mf.dispatchFetch(`${origin}/__fixture/state`);
  const data = await response.json();
  assert.deepEqual(data.blocked, [], 'No production route should attempt an unapproved TCP destination');
  return Object.fromEntries(Object.entries(data).map(([key, entries]) => [key, entries.filter(entry => entry.id === id)]));
}

function release(id) {
  kvGates.get(id)?.();
  kvGates.delete(id);
}

function settings(extra = {}) {
  const id = `tunnel-${++nextID}`;
  return { id, headers: { 'x-fixture-id': id, ...extra } };
}

function handshake(payload, hostname = target, port = 443) {
  const name = Buffer.from(hostname);
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, port >> 8, port & 255, 2, name.length]), name, payload]);
}

function varint(number) {
  const bytes = [];
  do { const byte = number & 127; number >>>= 7; bytes.push(byte | (number ? 128 : 0)); } while (number);
  return Buffer.from(bytes);
}

function grpcFrame(bytes) {
  const message = Buffer.concat([Buffer.from([10]), varint(bytes.length), bytes]);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

function grpcDecoder() {
  let pending = Buffer.alloc(0);
  return bytes => {
    pending = Buffer.concat([pending, bytes]);
    const out = [];
    while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
      const end = 5 + pending.readUInt32BE(1);
      assert.equal(pending[0], 0);
      assert.equal(pending[5], 10);
      let length = 0, shift = 0, position = 6, byte;
      do { byte = pending[position++]; length += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
      assert.equal(position + length, end);
      out.push(pending.subarray(position, end));
      pending = pending.subarray(end);
    }
    return Buffer.concat(out);
  };
}

async function openWS(options) {
  const response = await deadline(mf.dispatchFetch(`${origin}/tunnel?${options.query || ''}`, {
    headers: { Upgrade: 'websocket', ...options.headers },
  }), 'WebSocket upgrade blocked');
  assert.equal(response.status, 101);
  response.webSocket.accept();
  return response.webSocket;
}

function wsRead(ws, length, send) {
  return deadline(new Promise((resolve, reject) => {
    const parts = [];
    let total = 0;
    const clean = () => {
      ws.removeEventListener('message', message);
      ws.removeEventListener('close', closed);
      ws.removeEventListener('error', errored);
    };
    const message = event => {
      const bytes = Buffer.from(event.data);
      parts.push(bytes); total += bytes.length;
      if (total >= length) { clean(); resolve(Buffer.concat(parts)); }
    };
    const closed = () => { clean(); reject(new Error(`WebSocket closed after ${total}/${length} bytes`)); };
    const errored = () => { clean(); reject(new Error('WebSocket failed')); };
    ws.addEventListener('message', message);
    ws.addEventListener('close', closed);
    ws.addEventListener('error', errored);
    send();
  }), 'WebSocket did not return real destination bytes');
}

async function roundTrip(transport, options, payload = Buffer.from('real destination echo'), continuation) {
  const initial = handshake(payload, options.hostname, options.port);
  const expected = Buffer.concat([Buffer.from([0, 0]), payload]);
  if (transport === 'ws') {
    const ws = await openWS(options);
    try {
      assert.deepEqual(await wsRead(ws, expected.length, () => ws.send(initial)), expected);
      if (continuation) assert.deepEqual(await wsRead(ws, continuation.length, () => ws.send(continuation)), continuation);
    } finally { try { ws.close(); } catch {} }
    return;
  }
  const grpc = transport === 'grpc';
  let upload;
  const body = new ReadableStream({ start(controller) { upload = controller; } });
  upload.enqueue(grpc ? grpcFrame(initial) : initial);
  let reader;
  try {
    const response = await deadline(mf.dispatchFetch(`${origin}/tunnel${grpc ? '/Tun' : ''}?${options.query || ''}`, {
      method: 'POST', headers: { 'Content-Type': grpc ? 'application/grpc' : 'application/octet-stream', ...options.headers },
      body, duplex: 'half',
    }), `${transport} response blocked`);
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    const decode = grpc ? grpcDecoder() : bytes => bytes;
    let pending = Buffer.alloc(0);
    const read = length => deadline((async () => {
      while (pending.length < length) {
        const result = await reader.read();
        assert.equal(result.done, false, `${transport} must return real destination bytes`);
        pending = Buffer.concat([pending, decode(Buffer.from(result.value))]);
      }
      const out = pending.subarray(0, length);
      pending = pending.subarray(length);
      return out;
    })(), `${transport} echo blocked`);
    assert.deepEqual(await read(expected.length), expected);
    if (continuation) {
      upload.enqueue(grpc ? grpcFrame(continuation) : continuation);
      assert.deepEqual(await read(continuation.length), continuation);
    }
  } finally {
    try { upload.close(); } catch {}
    await reader?.cancel().catch(() => {});
  }
}

for (const transport of ['ws', 'grpc', 'xhttp']) {
  for (const route of ['direct', 'global chain', 'ProxyIP overriding a chain parameter']) {
    test(`${transport} ${route} forwards while unrelated KV would remain blocked`, { timeout: 10000 }, async () => {
      const options = settings({ 'x-fixture-block-kv': '1' });
      const global = route === 'global chain';
      if (global) options.query = `http=127.0.0.1:${proxyPort}&globalproxy`;
      if (route.startsWith('ProxyIP')) options.query = `http=127.0.0.1:${proxyPort}&proxyip=127.0.0.1:${proxyPort}`;
      const proxyBefore = proxyTargets.length;
      try {
        await roundTrip(transport, options);
        const actual = await state(options.id);
        assert.deepEqual(actual.reads, [], 'Unrelated KV must never enter the tunnel critical path');
        assert.equal(actual.dials.length, global ? 1 : 2);
        assert.ok(actual.dials.every(dial => dial.proxy === global));
        assert.equal(proxyTargets.length - proxyBefore, global ? 1 : 0);
      } finally { await release(options.id); }
    });
  }

  test(`${transport} selective chain waits for its whitelist and honors matching versus empty lists`, { timeout: 15000 }, async () => {
    for (const entries of [[target], []]) {
      const options = settings({ 'x-fixture-block-kv': '1', 'x-fixture-whitelist': JSON.stringify(entries) });
      options.query = `http=127.0.0.1:${proxyPort}`;
      let settled = false, pendingError;
      const pending = roundTrip(transport, options).catch(error => { pendingError = error; }).finally(() => { settled = true; });
      // Observe the actual KV call before releasing it. A timeout is only a
      // deadlock guard; no assertion depends on elapsed wall-clock speed.
      try {
        await deadline((async () => {
          while (!kvGates.has(options.id)) {
            if (settled) throw pendingError || new Error('Selective proxy completed without reading its whitelist');
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        })(), 'Selective proxy never read its whitelist');
        assert.equal(settled, false, 'Selective routing must wait for the saved policy');
        assert.deepEqual((await state(options.id)).dials, []);
      } finally { await release(options.id); }
      await pending;
      if (pendingError) throw pendingError;
      const actual = await state(options.id);
      assert.deepEqual(actual.reads, [{ id: options.id, key: 'config.json' }]);
      assert.equal(actual.dials.length, entries.length ? 1 : 2);
      assert.ok(actual.dials.every(dial => dial.proxy === Boolean(entries.length)));
    }
  });
}

// These are transparent TCP records, not a claim to complete a TLS handshake.
// Returning HTTP 204 in place of either payload must fail exact-byte assertions.
const tlsRecord = Buffer.from('1603010034010000300303' + '11'.repeat(32) + '000002130101000005000b000100', 'hex');
const continuation = Buffer.from(Array.from({ length: 32768 }, (_, index) => index % 251));
for (const transport of ['ws', 'grpc', 'xhttp']) {
  for (const hostname of ['speed.cloudflare.com', 'cp.cloudflare.com']) {
    for (const kind of ['HTTP', 'TLS']) {
      test(`${transport} forwards ${hostname} ${kind} bytes and continuation through real TCP`, { timeout: 10000 }, async () => {
        const options = { ...settings(), hostname, port: kind === 'HTTP' ? 80 : 443 };
        const payload = kind === 'HTTP' ? Buffer.from(`GET /generate_204 HTTP/1.1\r\nHost: ${hostname}\r\n\r\n`) : tlsRecord;
        const before = received.length;
        await roundTrip(transport, options, payload, continuation);
        const actual = await state(options.id);
        assert.equal(actual.dials.length, 2);
        assert.ok(actual.dials.every(dial => dial.hostname === hostname && dial.port === options.port && !dial.proxy));
        const sent = Buffer.concat(received.slice(before));
        const expected = Buffer.concat([payload, continuation]);
        assert.equal(sent.length, expected.length, 'Destination receives first and continued bytes exactly once');
        assert.equal(createHash('sha256').update(sent).digest('hex'), createHash('sha256').update(expected).digest('hex'));
      });
    }
  }
}

test('a mobile tunnel cannot lower a later ordinary tunnel dial count; explicit settings win', { timeout: 15000 }, async () => {
  for (const [headers, expected] of [
    [{ 'x-fixture-mobile': '1' }, 1],
    [{}, 2],
    [{ 'x-fixture-mobile': '1', 'x-fixture-tcp-concurrent-dial': '3' }, 3],
    [{}, 2],
  ]) {
    const options = settings(headers);
    await roundTrip('ws', options);
    assert.equal((await state(options.id)).dials.length, expected);
  }
});

test('overlapping WebSockets retain their own settings when handshakes arrive after another request', { timeout: 15000 }, async () => {
  const first = settings({ 'x-fixture-tcp-concurrent-dial': '4' });
  const second = settings({ 'x-fixture-mobile': '1' });
  const firstWS = await openWS(first);
  const secondWS = await openWS(second);
  const payload = Buffer.from('delayed protocol handshake');
  const expected = Buffer.concat([Buffer.from([0, 0]), payload]);
  try {
    assert.deepEqual(await wsRead(firstWS, expected.length, () => firstWS.send(handshake(payload))), expected);
    assert.deepEqual(await wsRead(secondWS, expected.length, () => secondWS.send(handshake(payload))), expected);
    assert.equal((await state(first.id)).dials.length, 4);
    assert.equal((await state(second.id)).dials.length, 1);
  } finally {
    try { firstWS.close(); } catch {}
    try { secondWS.close(); } catch {}
  }
});
