// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Exercise actual VLESS -> workerd -> HTTP CONNECT/direct TCP routing. All TCP
// endpoints are loopback fixtures and application fetches are fenced locally.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const uuid = '00000000-0000-4000-8000-000000000001';
const origin = 'https://whitelist.example.com';
const password = 'local-whitelist-regression-password';
const sockets = new Set();
const instances = [];
const outgoing = [];
const proxyTargets = [];
let mf, directServer, proxyServer, directPort, proxyPort, cookie, config;
let directConnections = 0;

function ownSocket(socket) {
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

async function createWorker(extraBindings = {}, kv = true) {
  const instance = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
    compatibilityDate: '2025-11-04',
    cf: { colo: 'TEST', asn: 0, country: 'XX', city: 'Local test' },
    ...(kv ? { kvNamespaces: ['KV'] } : {}),
    bindings: { ADMIN: password, UUID: uuid, OFF_LOG: 'true', PROXYIP: `127.0.0.1:${directPort}`, TCP_CONCURRENT_DIAL: '1', PROXY_CONCURRENT_DIAL: '1', ...extraBindings },
    outboundService: request => {
      outgoing.push(request.url);
      return new Response('External fetch blocked by local regression test', { status: 599 });
    },
  }));
  instances.push(instance);
  await instance.ready;
  return instance;
}

before(async () => {
  directServer = net.createServer(socket => {
    directConnections++;
    ownSocket(socket).pipe(socket);
  });
  directPort = await listen(directServer);
  proxyServer = net.createServer(socket => {
    ownSocket(socket);
    let pending = Buffer.alloc(0);
    const handshake = chunk => {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.removeListener('data', handshake);
      const match = /^CONNECT ([^ ]+) HTTP\/1\.1\r\n/.exec(pending.toString());
      // This fixture accepts only the loopback destination and implements an
      // echo tunnel itself so proxied bytes cannot be mistaken for direct TCP.
      if (!match || match[1] !== `127.0.0.1:${directPort}`) return socket.destroy();
      proxyTargets.push(match[1]);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const extra = pending.subarray(end + 4);
      if (extra.length) socket.write(extra);
      socket.pipe(socket);
    };
    socket.on('data', handshake);
  });
  proxyPort = await listen(proxyServer);
  mf = await createWorker();
  const login = await mf.dispatchFetch(origin + '/login', {
    method: 'POST', headers: { Origin: origin, 'User-Agent': 'Brclio-Whitelist-QA' },
    body: new URLSearchParams({ password }).toString(),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('Set-Cookie').split(';')[0];
  const response = await admin('/admin/config.json');
  assert.equal(response.status, 200);
  config = await response.json();
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(instances.map(instance => instance.dispose()));
  await Promise.all([directServer, proxyServer].filter(server => server?.listening).map(server => new Promise(resolve => server.close(resolve))));
});

function admin(path, body) {
  return mf.dispatchFetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, Cookie: cookie, 'User-Agent': 'Brclio-Whitelist-QA', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function saveWhitelist(entries) {
  config.反代.SOCKS5.白名单 = entries;
  const response = await admin('/admin/config.json', config);
  assert.equal(response.status, 200, await response.text());
  const saved = JSON.parse(await (await mf.getKVNamespace('KV')).get('config.json'));
  assert.deepEqual(saved.反代.SOCKS5.白名单, entries, 'The public configuration save route persisted the intended policy');
}

function handshake(payload) {
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, directPort >> 8, directPort & 255, 1, 127, 0, 0, 1]), payload]);
}

function deadline(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000); })])
    .finally(() => clearTimeout(timer));
}

async function openWS(instance = mf, query = `http=127.0.0.1:${proxyPort}`) {
  const response = await instance.dispatchFetch(`${origin}/?${query}`, { headers: { Upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  response.webSocket.accept();
  return response.webSocket;
}

async function echoWS(ws) {
  const payload = Buffer.from('real local whitelist routing');
  const received = await deadline(new Promise((resolve, reject) => {
    const parts = [];
    let length = 0;
    ws.addEventListener('message', event => {
      const bytes = Buffer.from(event.data);
      parts.push(bytes);
      length += bytes.length;
      if (length >= payload.length + 2) resolve(Buffer.concat(parts));
    });
    ws.addEventListener('error', () => reject(new Error('WebSocket echo failed')), { once: true });
    ws.send(handshake(payload));
  }), 'WebSocket whitelist echo timed out');
  assert.deepEqual(received, Buffer.concat([Buffer.from([0, 0]), payload]));
}

// Independent short protobuf encoder/decoder. Payloads here deliberately fit
// one-byte varints; transport framing still passes through the real Worker.
function grpcFrame(bytes) {
  assert.ok(bytes.length < 128);
  const header = Buffer.alloc(7);
  header.writeUInt32BE(bytes.length + 2, 1);
  header[5] = 10;
  header[6] = bytes.length;
  return Buffer.concat([header, bytes]);
}

async function echoHTTP(transport, instance = mf) {
  const payload = Buffer.from(`${transport} whitelist echo`);
  let upload;
  const body = new ReadableStream({ start(controller) { upload = controller; } });
  const initial = handshake(payload);
  upload.enqueue(transport === 'grpc' ? grpcFrame(initial) : initial);
  const response = await deadline(instance.dispatchFetch(`${origin}/local-test${transport === 'grpc' ? '/Tun' : ''}?http=127.0.0.1:${proxyPort}`, {
    method: 'POST', headers: { 'Content-Type': transport === 'grpc' ? 'application/grpc' : 'application/octet-stream' },
    body, duplex: 'half',
  }), `${transport} initial response timed out`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  try {
    const received = await deadline((async () => {
      let wire = Buffer.alloc(0);
      let decoded = Buffer.alloc(0);
      while (decoded.length < payload.length + 2) {
        const { value, done } = await reader.read();
        assert.equal(done, false, 'Tunnel must return echo data before closing');
        if (transport !== 'grpc') decoded = Buffer.concat([decoded, Buffer.from(value)]);
        else {
          wire = Buffer.concat([wire, Buffer.from(value)]);
          while (wire.length >= 5 && wire.length >= 5 + wire.readUInt32BE(1)) {
            const length = wire.readUInt32BE(1);
            assert.equal(wire[0], 0);
            assert.equal(wire[5], 10);
            assert.equal(wire[6], length - 2);
            decoded = Buffer.concat([decoded, wire.subarray(7, 5 + length)]);
            wire = wire.subarray(5 + length);
          }
        }
      }
      return decoded;
    })(), `${transport} whitelist echo timed out`);
    assert.deepEqual(received, Buffer.concat([Buffer.from([0, 0]), payload]));
  } finally {
    try { upload.close(); } catch {}
    await reader.cancel().catch(() => {});
  }
}

async function expectRoute(transport, expectedProxy, instance = mf, query) {
  const priorProxy = proxyTargets.length;
  const priorDirect = directConnections;
  if (transport === 'ws') {
    const ws = await openWS(instance, query);
    try { await echoWS(ws); } finally { try { ws.close(); } catch {} }
  } else await echoHTTP(transport, instance);
  assert.equal(proxyTargets.length - priorProxy, expectedProxy ? 1 : 0, `${transport} HTTP CONNECT route`);
  assert.equal(directConnections - priorDirect, expectedProxy ? 0 : 1, `${transport} direct TCP route`);
  assert.deepEqual(outgoing, [], 'Accepting/saving tunnels must not fetch usage or send notifications');
}

for (const transport of ['ws', 'grpc', 'xhttp']) {
  test(`${transport} applies newly saved whitelist entries and respects later empty/nonmatching lists`, { timeout: 20000 }, async () => {
    await saveWhitelist(['127.*']);
    await expectRoute(transport, true);
    await saveWhitelist([]);
    await expectRoute(transport, false);
    await saveWhitelist(['192.0.2.*', '127x0x0x1', '[']);
    await expectRoute(transport, false);
  });
}

test('overlapping WebSocket requests retain their own saved whitelist snapshot', { timeout: 15000 }, async () => {
  await saveWhitelist(['127.0.0.1']);
  const earlier = await openWS();
  await saveWhitelist([]);
  const later = await openWS();
  const beforeProxy = proxyTargets.length;
  const beforeDirect = directConnections;
  try {
    await echoWS(later);
    assert.equal(proxyTargets.length, beforeProxy);
    assert.equal(directConnections, beforeDirect + 1);
    await echoWS(earlier);
    assert.equal(proxyTargets.length, beforeProxy + 1);
    assert.equal(directConnections, beforeDirect + 1);
  } finally {
    try { earlier.close(); } catch {}
    try { later.close(); } catch {}
  }
});

test('global proxy mode and requests without a proxy address keep existing routing semantics', { timeout: 15000 }, async () => {
  await saveWhitelist([]);
  await expectRoute('ws', true, mf, `http=127.0.0.1:${proxyPort}&globalproxy`);
  await saveWhitelist(['*']);
  await expectRoute('ws', false, mf, '');
});

test('forced environment entries work with no KV, legacy config, and explicitly empty saved lists', { timeout: 20000 }, async () => {
  const withoutKV = await createWorker({ GO2SOCKS5: '192.0.2.*,127.0.0.1' }, false);
  await expectRoute('ws', true, withoutKV);
  const withKV = await createWorker({ GO2SOCKS5: '127.0.0.1' });
  const kv = await withKV.getKVNamespace('KV');
  await kv.put('config.json', JSON.stringify({ 反代: { SOCKS5: {} } }));
  await expectRoute('ws', true, withKV);
  await kv.put('config.json', JSON.stringify({ 反代: { SOCKS5: { 白名单: [] } } }));
  await expectRoute('xhttp', true, withKV);
  // A different request environment must not inherit this instance's force list.
  await saveWhitelist([]);
  await expectRoute('ws', false);
});
