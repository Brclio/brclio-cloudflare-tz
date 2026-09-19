// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Real workerd WebSocket -> TCP round trips. All destination traffic stays on
// a loopback server created by this test; no third-party proxy is required.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const uuid = '00000000-0000-4000-8000-000000000001';
const sockets = new Set();
let mf;
let server;
let tcpPort;
let acceptedConnections = 0;
const root = fileURLToPath(new URL('..', import.meta.url));
// The production connector seam maps the named regression destination onto
// real local TCP. Every other destination is rejected, so protocol tests cannot
// accidentally contact a public endpoint. Early-data is inserted inside workerd
// because dispatchFetch may normalize WebSocket subprotocol negotiation.
const wrapper = `
import worker from './dist/_worker.js';
import { connect } from 'cloudflare:sockets';
export default { fetch(request, env, ctx) {
  if (request.headers.has('x-fixture-early-data')) {
    const headers = new Headers(request.headers);
    headers.set('sec-websocket-protocol', headers.get('x-fixture-early-data'));
    request = new Request(request, { headers });
  }
  Object.defineProperty(request, 'cf', { value: { colo: 'TEST', asn: 0, country: 'XX', city: 'Local test' } });
  Object.defineProperty(request, 'fetcher', { value: { connect(options, init) {
    const local = options.hostname === '127.0.0.1' && options.port === Number(env.FIXTURE_PORT);
    const named = options.hostname === 'fixture.example.com' && options.port === 443;
    if (!local && !named) throw new Error('Unexpected destination in local protocol test');
    return connect({ hostname: '127.0.0.1', port: Number(env.FIXTURE_PORT) }, init);
  } } });
  return worker.fetch(request, env, ctx);
} };
`;

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
    modulesRoot: root,
    modules: [
      { type: 'ESModule', path: `${root}/tunnel-protocol-fixture.mjs`, contents: wrapper },
      { type: 'ESModule', path: `${root}/dist/_worker.js` },
    ],
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
      FIXTURE_PORT: String(tcpPort),
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

async function openWebSocket(path = '/', headers = {}) {
  const response = await mf.dispatchFetch(`https://tunnel.example.com${path}`, {
    headers: { Upgrade: 'websocket', 'User-Agent': 'Brclio-Protocol-QA', ...headers },
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

// Independent clients below use Node's native crypto and wire encoders instead
// of importing the Worker's parser or encryption helpers. This makes a broken
// shared encoder/decoder unable to manufacture a successful round trip.
const wrongUuid = '00000000-0000-4000-8000-000000000002';
const continuation = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 251));

function trojanHandshake(id, payload) {
  return Buffer.concat([
    Buffer.from(createHash('sha224').update(id).digest('hex') + '\r\n'),
    Buffer.from([1, 1, 127, 0, 0, 1, tcpPort >> 8, tcpPort & 255, 13, 10]),
    payload,
  ]);
}

function assertSameBytes(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: byte count`);
  assert.equal(createHash('sha256').update(actual).digest('hex'),
    createHash('sha256').update(expected).digest('hex'), `${label}: exact byte content`);
}

async function rejectWebSocketPayload(path, payload) {
  const connectionsBefore = acceptedConnections;
  const ws = await openWebSocket(path);
  let receivedBytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Invalid handshake was not closed')), 5000);
      ws.addEventListener('message', event => { receivedBytes += Buffer.from(event.data).length; });
      ws.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.send(payload);
    });
    assert.equal(receivedBytes, 0, 'Rejected requests must not receive destination data');
    assert.equal(acceptedConnections, connectionsBefore, 'Rejected requests must not dial TCP');
  } finally {
    try { ws.close(); } catch {}
  }
}

test('Trojan WebSocket authenticates and forwards first plus continuation bytes through local TCP', { timeout: 15000 }, async () => {
  const connectionsBefore = acceptedConnections;
  const ws = await openWebSocket();
  try {
    const greeting = Buffer.from('Trojan initial payload: binary\x00\xff');
    const first = await receiveBytes(ws, greeting.length, () => ws.send(trojanHandshake(uuid, greeting)));
    assertSameBytes(first, greeting, 'Trojan first response has no VLESS header');
    const next = await receiveBytes(ws, continuation.length, () => {
      for (let offset = 0; offset < continuation.length; offset += 4096) ws.send(continuation.subarray(offset, offset + 4096));
    });
    assertSameBytes(next, continuation, 'Trojan continuation');
    assert.equal(acceptedConnections, connectionsBefore + 1);
  } finally {
    try { ws.close(); } catch {}
  }
});

test('Trojan WebSocket rejects a wrong password before opening local TCP', { timeout: 10000 }, async () => {
  await rejectWebSocketPayload('/', trojanHandshake(wrongUuid, Buffer.from('must-not-reach-tcp')));
});

// Shadowsocks SIP004: EVP_BytesToKey(MD5), HKDF-SHA1(ss-subkey), AES-GCM,
// separate length/payload records, little-endian 96-bit per-direction nonces.
function ssSessionKey(password, salt, keyLength) {
  let previous = Buffer.alloc(0);
  let derived = Buffer.alloc(0);
  while (derived.length < keyLength) {
    previous = createHash('md5').update(previous).update(password).digest();
    derived = Buffer.concat([derived, previous]);
  }
  return Buffer.from(hkdfSync('sha1', derived.subarray(0, keyLength), salt, 'ss-subkey', keyLength));
}

function nextNonce(counter) {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64LE(counter);
  return nonce;
}

function ssEncoder(method, password) {
  const keyLength = method === 'aes-128-gcm' ? 16 : 32;
  const salt = randomBytes(keyLength);
  const key = ssSessionKey(password, salt, keyLength);
  let nonce = 0n;
  let sentSalt = false;
  function encrypt(plain) {
    const cipher = createCipheriv(method, key, nextNonce(nonce++));
    return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  }
  return plain => {
    const records = sentSalt ? [] : [salt];
    sentSalt = true;
    for (let offset = 0; offset < plain.length; offset += 0x3fff) {
      const chunk = plain.subarray(offset, offset + 0x3fff);
      const length = Buffer.alloc(2);
      length.writeUInt16BE(chunk.length);
      records.push(encrypt(length), encrypt(chunk));
    }
    return Buffer.concat(records);
  };
}

function ssDecoder(method, password) {
  const keyLength = method === 'aes-128-gcm' ? 16 : 32;
  let pending = Buffer.alloc(0);
  let key;
  let nonce = 0n;
  let payloadLength = null;
  function decrypt(encrypted) {
    const decipher = createDecipheriv(method, key, nextNonce(nonce++));
    decipher.setAuthTag(encrypted.subarray(-16));
    return Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  }
  return chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (!key) {
      if (pending.length < keyLength) return Buffer.alloc(0);
      key = ssSessionKey(password, pending.subarray(0, keyLength), keyLength);
      pending = pending.subarray(keyLength);
    }
    const output = [];
    while (true) {
      if (payloadLength === null) {
        if (pending.length < 18) break;
        payloadLength = decrypt(pending.subarray(0, 18)).readUInt16BE();
        assert.ok(payloadLength <= 0x3fff, 'SS response obeys maximum record size');
        pending = pending.subarray(18);
      }
      if (pending.length < payloadLength + 16) break;
      output.push(decrypt(pending.subarray(0, payloadLength + 16)));
      pending = pending.subarray(payloadLength + 16);
      payloadLength = null;
    }
    return Buffer.concat(output);
  };
}

function receiveDecodedWebSocket(ws, decode, expectedLength, send) {
  return new Promise((resolve, reject) => {
    const output = [];
    let length = 0;
    const timer = setTimeout(() => finish(new Error(`SS echo timed out (${length}/${expectedLength})`)), 5000);
    function finish(error) {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      if (error) reject(error);
      else resolve(Buffer.concat(output));
    }
    function onMessage(event) {
      try {
        const plain = decode(Buffer.from(event.data));
        output.push(plain);
        length += plain.length;
        if (length >= expectedLength) finish();
      } catch (error) { finish(error); }
    }
    function onClose() { finish(new Error('SS WebSocket closed before the echo')); }
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    try { send(); } catch (error) { finish(error); }
  });
}

for (const method of ['aes-128-gcm', 'aes-256-gcm']) {
  test(`Shadowsocks ${method} WebSocket decrypts/encrypts first and continuation data through local TCP`, { timeout: 15000 }, async () => {
    const connectionsBefore = acceptedConnections;
    const ws = await openWebSocket(`/?enc=${method}`);
    const encode = ssEncoder(method, uuid);
    const decode = ssDecoder(method, uuid);
    try {
      const greeting = Buffer.from(`Shadowsocks ${method} first payload\x00`);
      const address = Buffer.from([1, 127, 0, 0, 1, tcpPort >> 8, tcpPort & 255]);
      const firstFrame = encode(Buffer.concat([address, greeting]));
      const first = await receiveDecodedWebSocket(ws, decode, greeting.length, () => {
        // Fragment the salt and AEAD records across actual WebSocket messages.
        ws.send(firstFrame.subarray(0, 7));
        ws.send(firstFrame.subarray(7, 23));
        ws.send(firstFrame.subarray(23));
      });
      assertSameBytes(first, greeting, `${method} first response`);
      const next = await receiveDecodedWebSocket(ws, decode, continuation.length, () => {
        const frame = encode(continuation);
        for (let offset = 0; offset < frame.length; offset += 4096) ws.send(frame.subarray(offset, offset + 4096));
      });
      assertSameBytes(next, continuation, `${method} continuation`);
      assert.equal(acceptedConnections, connectionsBefore + 1);
    } finally {
      try { ws.close(); } catch {}
    }
  });

  test(`Shadowsocks ${method} WebSocket rejects a wrong password before local TCP`, { timeout: 10000 }, async () => {
    const encode = ssEncoder(method, wrongUuid);
    const address = Buffer.from([1, 127, 0, 0, 1, tcpPort >> 8, tcpPort & 255]);
    await rejectWebSocketPayload(`/?enc=${method}`, encode(Buffer.concat([address, Buffer.alloc(96, 65)])));
  });
}

function varint(value) {
  const bytes = [];
  while (value > 127) { bytes.push((value & 127) | 128); value >>>= 7; }
  bytes.push(value);
  return Buffer.from(bytes);
}

// Official Xray wire schema: Hunk { bytes data = 1; },
// MultiHunk { repeated bytes data = 1; }. A genuine multi test must encode
// multiple protobuf fields in ONE gRPC message, not just change the URL.
// https://github.com/XTLS/Xray-core/blob/main/transport/internet/grpc/encoding/stream.proto
function grpcFrame(fields) {
  const message = Buffer.concat(fields.flatMap(field => [Buffer.from([10]), varint(field.length), field]));
  const header = Buffer.alloc(5);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

function grpcDecoder() {
  let pending = Buffer.alloc(0);
  return chunk => {
    pending = Buffer.concat([pending, chunk]);
    const output = [];
    while (pending.length >= 5) {
      assert.equal(pending[0], 0, 'Uncompressed gRPC envelope');
      const length = pending.readUInt32BE(1);
      if (pending.length < 5 + length) break;
      const message = pending.subarray(5, 5 + length);
      pending = pending.subarray(5 + length);
      let offset = 0;
      while (offset < message.length) {
        assert.equal(message[offset++], 10, 'Response protobuf field is bytes data = 1');
        let fieldLength = 0;
        let shift = 0;
        let byte;
        do {
          assert.ok(offset < message.length && shift <= 28, 'Valid protobuf length');
          byte = message[offset++];
          fieldLength += (byte & 127) * 2 ** shift;
          shift += 7;
        } while (byte & 128);
        assert.ok(offset + fieldLength <= message.length, 'Complete protobuf bytes field');
        output.push(message.subarray(offset, offset + fieldLength));
        offset += fieldLength;
      }
    }
    return Buffer.concat(output);
  };
}

function withTimeout(promise, label, ms = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })])
    .finally(() => clearTimeout(timer));
}

async function openHttpTunnel(transport, initial, endUpload = false) {
  let upload;
  // Rejection fixtures are finite requests: submit a known-length body so an
  // immediate 400 cannot race an unnecessary chunked upload through Miniflare's
  // Undici bridge. Successful tunnel fixtures retain their streaming upload.
  let body = initial;
  if (!endUpload) {
    body = new ReadableStream({ start(controller) { upload = controller; } });
    // Deliberately split a gRPC envelope / protocol header across HTTP chunks.
    upload.enqueue(initial.subarray(0, 2));
    upload.enqueue(initial.subarray(2, 13));
    upload.enqueue(initial.subarray(13));
  }
  const isGrpc = transport.startsWith('grpc');
  const path = transport === 'grpc-multi' ? '/local-test/TunMulti' : isGrpc ? '/local-test/Tun' : '/local-test';
  const response = await withTimeout(mf.dispatchFetch(`https://tunnel.example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': isGrpc ? 'application/grpc' : 'application/octet-stream', 'User-Agent': 'Brclio-Protocol-QA' },
    body,
    duplex: 'half',
  }), `${transport} initial response timed out`);
  const reader = response.body.getReader();
  const decode = isGrpc ? grpcDecoder() : bytes => bytes;
  let pending = Buffer.alloc(0);
  return {
    response,
    send(bytes) { upload.enqueue(bytes); },
    async readBytes(length) {
      return withTimeout((async () => {
        while (pending.length < length) {
          const result = await reader.read();
          if (result.done) throw new Error(`${transport} response ended after ${pending.length}/${length} bytes`);
          pending = Buffer.concat([pending, decode(Buffer.from(result.value))]);
        }
        const out = pending.subarray(0, length);
        pending = pending.subarray(length);
        return out;
      })(), `${transport} echo timed out`);
    },
    async readToEnd() {
      return withTimeout((async () => {
        const parts = [pending];
        while (true) {
          const { done, value } = await reader.read();
          if (done) return Buffer.concat(parts);
          parts.push(decode(Buffer.from(value)));
        }
      })(), `${transport} rejection did not finish`);
    },
    async close() {
      try { upload?.close(); } catch {}
      await reader.cancel().catch(() => {});
    },
  };
}

for (const [protocol, handshake] of [['VLESS', vlessHandshake], ['Trojan', trojanHandshake]]) {
  for (const transport of ['grpc-gun', 'grpc-multi', 'xhttp']) {
    test(`${protocol} ${transport} carries first and continuation bytes through local TCP`, { timeout: 15000 }, async () => {
      const connectionsBefore = acceptedConnections;
      const greeting = Buffer.from(`${protocol} ${transport} first payload\x00`);
      const firstHalf = greeting.subarray(0, 8);
      const secondHalf = greeting.subarray(8);
      const initial = transport === 'grpc-multi'
        ? grpcFrame([handshake(uuid, firstHalf), secondHalf])
        : transport === 'grpc-gun' ? grpcFrame([handshake(uuid, greeting)]) : handshake(uuid, greeting);
      const tunnel = await openHttpTunnel(transport, initial);
      try {
        assert.equal(tunnel.response.status, 200);
        const expectedFirst = protocol === 'VLESS' ? Buffer.concat([Buffer.from([0, 0]), greeting]) : greeting;
        assertSameBytes(await tunnel.readBytes(expectedFirst.length), expectedFirst, `${protocol} ${transport} first response`);
        for (let offset = 0; offset < continuation.length; offset += 4096) {
          const chunk = continuation.subarray(offset, offset + 4096);
          tunnel.send(transport === 'grpc-multi' ? grpcFrame([chunk.subarray(0, 17), chunk.subarray(17)])
            : transport === 'grpc-gun' ? grpcFrame([chunk]) : chunk);
        }
        assertSameBytes(await tunnel.readBytes(continuation.length), continuation, `${protocol} ${transport} continuation`);
        assert.equal(acceptedConnections, connectionsBefore + 1, 'Continuation reuses the authenticated TCP connection');
      } finally {
        await tunnel.close();
      }
    });

    test(`${protocol} ${transport} rejects a wrong credential without local TCP`, { timeout: 10000 }, async () => {
      const connectionsBefore = acceptedConnections;
      const invalid = handshake(wrongUuid, Buffer.from('must-not-reach-tcp'));
      const initial = transport.startsWith('grpc') ? grpcFrame([invalid]) : invalid;
      // Send the complete invalid request as a finite body; authentication
      // rejection must still return the expected status/body without any TCP.
      const tunnel = await openHttpTunnel(transport, initial, true);
      try {
        const response = await tunnel.readToEnd();
        if (transport === 'xhttp') {
          assert.equal(tunnel.response.status, 400);
          assert.equal(response.toString(), 'Invalid request');
        } else {
          // Upstream closes gRPC body on authentication failure; HTTP status
          // remains 200, so status alone is not evidence of authentication.
          assert.equal(tunnel.response.status, 200);
          assert.equal(response.length, 0);
        }
        assert.equal(acceptedConnections, connectionsBefore, 'Wrong credentials must never dial TCP');
      } finally {
        await tunnel.close();
      }
    });
  }
}

// A normal HTTP request to this hostname places CRLF at packet bytes 56/57.
// The old WS/gRPC discriminator mistook those application bytes for Trojan.
function vlessHttpCollision(payload) {
  const host = Buffer.from('fixture.example.com');
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, 1, 187, 2, host.length]), host, payload]);
}

for (const transport of ['ws', 'grpc-gun', 'xhttp']) {
  test(`VLESS ${transport} authenticates the HTTP CRLF collision instead of misclassifying it as Trojan`, { timeout: 10000 }, async () => {
    const before = acceptedConnections;
    const payload = Buffer.from('GET / HTTP/1.1\r\nHost: fixture.example.com\r\n\r\n');
    const packet = vlessHttpCollision(payload);
    assert.deepEqual(packet.subarray(56, 58), Buffer.from('\r\n'));
    const expected = Buffer.concat([Buffer.from([0, 0]), payload]);
    if (transport === 'ws') {
      const ws = await openWebSocket();
      try { assertSameBytes(await receiveBytes(ws, expected.length, () => ws.send(packet)), expected, 'HTTP collision'); }
      finally { try { ws.close(); } catch {} }
    } else {
      const tunnel = await openHttpTunnel(transport, transport === 'grpc-gun' ? grpcFrame([packet]) : packet);
      try { assertSameBytes(await tunnel.readBytes(expected.length), expected, 'HTTP collision'); }
      finally { await tunnel.close(); }
    }
    assert.equal(acceptedConnections, before + 1);
  });
}

for (const [protocol, handshake] of [['VLESS', vlessHandshake], ['Trojan', trojanHandshake]]) {
  test(`${protocol} WebSocket buffers a header delivered one byte per message`, { timeout: 10000 }, async () => {
    const before = acceptedConnections;
    const payload = Buffer.from(`${protocol} fragmented header payload`);
    const packet = handshake(uuid, payload);
    const expected = protocol === 'VLESS' ? Buffer.concat([Buffer.from([0, 0]), payload]) : payload;
    const headerLength = packet.length - payload.length;
    const ws = await openWebSocket();
    try {
      const output = await receiveBytes(ws, expected.length, () => {
        for (let index = 0; index < headerLength; index++) ws.send(packet.subarray(index, index + 1));
        ws.send(packet.subarray(headerLength));
      });
      assertSameBytes(output, expected, 'One-byte header fragments');
      assert.equal(acceptedConnections, before + 1);
    } finally { try { ws.close(); } catch {} }
  });

  test(`${protocol} WebSocket retains partial early-data until the remaining header arrives`, { timeout: 15000 }, async () => {
    const payload = Buffer.from(`${protocol} early-data remainder`);
    const packet = handshake(uuid, payload);
    const expected = protocol === 'VLESS' ? Buffer.concat([Buffer.from([0, 0]), payload]) : payload;
    for (const split of protocol === 'VLESS' ? [1, 8, 18] : [1, 24, 56]) {
      const before = acceptedConnections;
      const ws = await openWebSocket('/', { 'x-fixture-early-data': packet.subarray(0, split).toString('base64url') });
      try {
        assert.equal(acceptedConnections, before, 'An incomplete credential/header cannot dial');
        const output = await receiveBytes(ws, expected.length, () => ws.send(packet.subarray(split)));
        assertSameBytes(output, expected, `Early-data split ${split}`);
        assert.equal(acceptedConnections, before + 1);
      } finally { try { ws.close(); } catch {} }
    }
  });

  for (const transport of ['grpc-gun', 'grpc-multi']) {
    test(`${protocol} ${transport} buffers protocol headers across distinct protobuf messages`, { timeout: 10000 }, async () => {
      const before = acceptedConnections;
      const payload = Buffer.from(`${protocol} ${transport} split Hunks`);
      const packet = handshake(uuid, payload);
      const split = protocol === 'VLESS' ? 8 : 24;
      const chunks = [packet.subarray(0, split), packet.subarray(split, split + 3), packet.subarray(split + 3)];
      const initial = Buffer.concat(chunks.map(chunk => grpcFrame(transport === 'grpc-multi'
        ? [chunk.subarray(0, 1), chunk.subarray(1)] : [chunk])));
      const tunnel = await openHttpTunnel(transport, initial);
      try {
        const expected = protocol === 'VLESS' ? Buffer.concat([Buffer.from([0, 0]), payload]) : payload;
        assertSameBytes(await tunnel.readBytes(expected.length), expected, 'Protocol header split between Hunks');
        assert.equal(acceptedConnections, before + 1);
      } finally { await tunnel.close(); }
    });
  }

  test(`${protocol} rejects malformed commands and address types across all transports before local TCP`, { timeout: 15000 }, async () => {
    const packet = handshake(uuid, Buffer.from('must-not-reach-tcp'));
    for (const offset of protocol === 'VLESS' ? [18, 21] : [58, 59, 56, 66]) {
      const malformed = Buffer.from(packet);
      malformed[offset] = 255;
      await rejectWebSocketPayload('/', malformed);
      for (const transport of ['grpc-gun', 'xhttp']) {
        const before = acceptedConnections;
        const tunnel = await openHttpTunnel(transport, transport === 'grpc-gun' ? grpcFrame([malformed]) : malformed, true);
        try {
          const response = await tunnel.readToEnd();
          assert.equal(tunnel.response.status, transport === 'xhttp' ? 400 : 200);
          assert.equal(response.toString(), transport === 'xhttp' ? 'Invalid request' : '');
          assert.equal(acceptedConnections, before, `Malformed ${protocol} field ${offset} must not dial`);
        } finally { await tunnel.close(); }
      }
    }
  });
}

test('WebSocket binary subprotocol is ignored before a normal authenticated handshake', { timeout: 10000 }, async () => {
  const payload = Buffer.from('binary is a subprotocol name');
  const expected = Buffer.concat([Buffer.from([0, 0]), payload]);
  const ws = await openWebSocket('/', { 'x-fixture-early-data': 'binary' });
  try {
    assertSameBytes(await receiveBytes(ws, expected.length, () => ws.send(vlessHandshake(uuid, payload))), expected, 'binary subprotocol');
  } finally { try { ws.close(); } catch {} }
});
