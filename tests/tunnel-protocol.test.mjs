// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Real workerd WebSocket -> TCP round trips. All destination traffic stays on
// a loopback server created by this test; no third-party proxy is required.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const uuid = '00000000-0000-4000-8000-000000000001';
const sockets = new Set();
let mf;
let server;
let tcpPort;
let acceptedConnections = 0;

before(async () => {
  server = net.createServer(socket => {
    acceptedConnections++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.pipe(socket);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  tcpPort = server.address().port;
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
    compatibilityDate: '2025-11-04',
    cf: { colo: 'TEST', asn: 0, country: 'XX', city: 'Local test' },
    kvNamespaces: ['KV'],
    bindings: {
      ADMIN: 'local-protocol-test-password',
      UUID: uuid,
      OFF_LOG: 'true',
      PROXYIP: `127.0.0.1:${tcpPort}`,
      TCP_CONCURRENT_DIAL: '1',
      PROXY_CONCURRENT_DIAL: '1',
    },
  }));
  await mf.ready;
});

after(async () => {
  // Destroy owned sockets before disposing workerd so an assertion failure
  // cannot leave an echo connection keeping the test process alive.
  for (const socket of sockets) socket.destroy();
  if (mf) await mf.dispose();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

async function openWebSocket() {
  const response = await mf.dispatchFetch('https://tunnel.example.com/', {
    headers: { Upgrade: 'websocket', 'User-Agent': 'Brclio-Protocol-QA' },
  });
  assert.equal(response.status, 101);
  assert.ok(response.webSocket, 'Worker must return an upgraded WebSocket');
  response.webSocket.accept();
  return response.webSocket;
}

function vlessHandshake(id, payload, command = 1) {
  // VLESS v0: version, UUID, zero option bytes, TCP command, big-endian port,
  // IPv4 address type, 127.0.0.1, and the first application payload.
  return Buffer.concat([
    Buffer.from([0]),
    Buffer.from(id.replaceAll('-', ''), 'hex'),
    Buffer.from([0, command, tcpPort >> 8, tcpPort & 255, 1, 127, 0, 0, 1]),
    payload,
  ]);
}

function receiveBytes(ws, expectedLength, send) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let length = 0;
    const timer = setTimeout(() => finish(new Error(`TCP echo timed out (${length}/${expectedLength} bytes)`)), 5000);
    function finish(error, value) {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
      if (error) reject(error);
      else resolve(value);
    }
    function onMessage(event) {
      const bytes = Buffer.from(event.data);
      parts.push(bytes);
      length += bytes.length;
      if (length >= expectedLength) finish(null, Buffer.concat(parts));
    }
    function onError() { finish(new Error('WebSocket reported an error during TCP echo')); }
    function onClose() { finish(new Error(`WebSocket closed before echo completed (${length}/${expectedLength} bytes)`)); }
    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);
    try { send(); } catch (error) { finish(error); }
  });
}

async function expectRejectedHandshake(id, command = 1) {
  const connectionsBefore = acceptedConnections;
  const ws = await openWebSocket();
  let receivedBytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Invalid handshake was not closed')), 5000);
      ws.addEventListener('message', event => { receivedBytes += Buffer.from(event.data).length; });
      ws.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.send(vlessHandshake(id, Buffer.from('must-not-reach-tcp'), command));
    });
    assert.equal(receivedBytes, 0, 'Rejected requests must not receive destination data');
    assert.equal(acceptedConnections, connectionsBefore, 'Rejected requests must not open a TCP connection');
  } finally {
    try { ws.close(); } catch {}
  }
}

test('built Worker rejects VLESS UUIDs that do not match the configured credential', { timeout: 10000 }, async () => {
  await expectRejectedHandshake('00000000-0000-4000-8000-000000000002');
});

test('built Worker rejects unsupported VLESS commands before dialing TCP', { timeout: 10000 }, async () => {
  await expectRejectedHandshake(uuid, 3);
});

test('built Worker forwards authenticated VLESS WebSocket data through a real local TCP socket', { timeout: 15000 }, async () => {
  const connectionsBefore = acceptedConnections;
  const ws = await openWebSocket();
  try {
    const greeting = Buffer.from('Brclio local TCP round trip');
    const firstResponse = await receiveBytes(ws, greeting.length + 2, () => ws.send(vlessHandshake(uuid, greeting)));
    assert.deepEqual(firstResponse, Buffer.concat([Buffer.from([0, 0]), greeting]), 'First response must contain the VLESS response header followed by real echo data');
    assert.equal(acceptedConnections, connectionsBefore + 1);

    // Multiple subsequent frames exceed the Worker coalescing threshold and
    // must survive the upstream queue without loss, duplication, or reordering.
    const continuation = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 251));
    const secondResponse = await receiveBytes(ws, continuation.length, () => {
      for (let offset = 0; offset < continuation.length; offset += 4096) {
        ws.send(continuation.subarray(offset, offset + 4096));
      }
    });
    assert.deepEqual(secondResponse, continuation, 'Continuation bytes must be forwarded exactly once and in order');
    assert.equal(acceptedConnections, connectionsBefore + 1, 'Continuation frames should reuse the authenticated TCP connection');
  } finally {
    try { ws.close(); } catch {}
  }
});
