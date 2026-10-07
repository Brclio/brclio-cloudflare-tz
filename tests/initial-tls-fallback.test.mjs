// Copyright (C) 2026 Brclio. GPL-2.0-only.
// A real TLS client must survive initial direct EOF regardless of tunnel framing.
// All sockets and HTTP traffic remain inside this loopback fixture.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { Duplex } from 'node:stream';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import WebSocket from 'ws';
import { decodeHunk } from '../src/grpc.js';
import { canReplayInitialData, createInitialReplayTracker, MAX_INITIAL_TLS_BYTES } from '../src/tunnel-runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const uuid = '00000000-0000-4000-8000-000000000001';
const header = Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'), Buffer.from([0, 1, 1, 187, 1, 192, 0, 2, 1])]);
const body = Buffer.alloc(65536, 83), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const live = new Set(), records = [];
let mf, fixtureDir, direct, fallback, workerURL, cert, capturedHello;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function deadline(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 4000); })]).finally(() => clearTimeout(timer));
}
function track(socket, mode) {
  live.add(socket); socket.on('close', () => live.delete(socket)); socket.on('error', () => {});
  const record = { mode, bytes: [], application: [] }; records.push(record); return record;
}
function frame(payload) {
  let length = payload.length; const varint = [];
  do { const byte = length & 127; length >>>= 7; varint.push(byte | (length ? 128 : 0)); } while (length);
  const message = Buffer.concat([Buffer.from([10, ...varint]), payload]), prefix = Buffer.alloc(5);
  prefix.writeUInt32BE(message.length, 1); return Buffer.concat([prefix, message]);
}
before(async () => {
  cert = await readFile(path.join(root, 'tests/fixtures/untrusted-proxy-cert.pem'));
  const key = await readFile(path.join(root, 'tests/fixtures/untrusted-proxy-key.pem'));
  direct = net.createServer({ allowHalfOpen: true }, socket => {
    const record = track(socket, 'direct');
    socket.on('data', chunk => {
      record.bytes.push(Buffer.from(chunk)); const bytes = Buffer.concat(record.bytes);
      // Refuse the route only after receiving one complete real TLS record.
      if (bytes.length >= 5 && bytes.length >= 5 + bytes.readUInt16BE(3)) socket.end();
    });
    socket.on('end', () => socket.end());
  });
  fallback = tls.createServer({ key, cert }, socket => {
    const record = track(socket, 'fallback');
    socket.on('data', chunk => {
      record.application.push(Buffer.from(chunk));
      if (Buffer.concat(record.application).includes(Buffer.from('\r\n\r\n'))) socket.end(Buffer.concat([
        Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`), body,
      ]));
    });
  });
  fallback.on('tlsClientError', () => {});
  await Promise.all([direct, fallback].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'brclio-initial-tls-'));
  await build({
    entryPoints: [path.join(root, 'src/worker.js')], outfile: path.join(fixtureDir, 'worker.mjs'), bundle: true,
    format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:sockets'],
    plugins: [{ name: 'fixture-assets', setup(b) {
      b.onResolve({ filter: /^brclio:/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  await writeFile(path.join(fixtureDir, 'entry.mjs'), `
import worker from './worker.mjs'; import { connect } from 'cloudflare:sockets';
export default { fetch(request, env, ctx) {
  Object.defineProperty(request, 'cf', { value: { colo: 'TEST', asn: 0 } });
  Object.defineProperty(request, 'fetcher', { value: { connect(options, init) {
    return connect({ hostname: '127.0.0.1', port: Number(options.hostname === '192.0.2.1' ? env.DIRECT : env.FALLBACK) }, init);
  } } }); return worker.fetch(request, env, ctx);
} };`);
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: fixtureDir, modules: ['entry.mjs', 'worker.mjs'].map(name => ({ type: 'ESModule', path: path.join(fixtureDir, name) })),
    compatibilityDate: '2026-09-18', bindings: { ADMIN: 'fixture', UUID: uuid, PROXYIP: '198.51.100.2',
      TCP_CONCURRENT_DIAL: '1', OFF_LOG: 'true', DIRECT: String(direct.address().port), FALLBACK: String(fallback.address().port) },
    outboundService() { throw new Error('This fixture permits no outbound HTTP'); },
  }));
  workerURL = await mf.ready;
});
after(async () => {
  for (const socket of live) socket.destroy(); await mf?.dispose();
  await Promise.all([direct, fallback].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

async function requestThroughTunnel(protocol, layout) {
  const start = records.length; let websocket, uploader, responseReader, receiveTask, bridge;
  let prefix = Buffer.alloc(0), first = true, hello, authorized = false;
  const feed = value => {
    if (prefix.length < 2) { prefix = Buffer.concat([prefix, value]); if (prefix.length < 2) return; value = prefix.subarray(2); prefix = Buffer.alloc(2); }
    if (value.length) bridge.push(value);
  };
  let send;
  if (protocol === 'ws') {
    const url = new URL('/tunnel', workerURL); url.protocol = 'ws:'; websocket = new WebSocket(url);
    await once(websocket, 'open'); send = bytes => new Promise((resolve, reject) => websocket.send(bytes, error => error ? reject(error) : resolve()));
  } else {
    const upload = new ReadableStream({ start(controller) { uploader = controller; } });
    send = async bytes => { uploader.enqueue(frame(bytes)); };
    const responseTask = mf.dispatchFetch(`https://fixture.example/${protocol === 'multi' ? 'TunMulti' : 'Tun'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/grpc' }, body: upload, duplex: 'half',
    });
    receiveTask = (async () => {
      const response = await responseTask; assert.equal(response.status, 200); responseReader = response.body.getReader();
      let pending = Buffer.alloc(0);
      while (true) {
        const { done, value } = await responseReader.read(); if (done) break;
        pending = Buffer.concat([pending, value]);
        while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
          const length = pending.readUInt32BE(1); feed(Buffer.from(decodeHunk(pending.subarray(5, 5 + length)))); pending = pending.subarray(5 + length);
        }
      }
      assert.equal(pending.length, 0); bridge.push(null);
    })();
    receiveTask.catch(error => bridge?.destroy(error));
  }
  if (layout === 'separate' || layout === 'fragmented') { await send(header); await pause(25); }
  bridge = new Duplex({
    read() {},
    write(bytes, encoding, callback) {
      void (async () => {
        if (first) {
          first = false; hello = Buffer.from(bytes); capturedHello = hello;
          if (layout === 'combined') return send(Buffer.concat([header, bytes]));
          if (layout === 'partial-first') { await send(Buffer.concat([header, bytes.subarray(0, 19)])); await pause(25); return send(bytes.subarray(19)); }
          if (layout === 'fragmented') { for (let offset = 0; offset < bytes.length; offset += 17) await send(bytes.subarray(offset, offset + 17)); return; }
        }
        return send(bytes);
      })().then(() => callback(), callback);
    },
    destroy(error, callback) { websocket?.terminate(); try { uploader?.close(); } catch {} callback(error); },
  });
  websocket?.on('message', value => feed(Buffer.from(value)));
  websocket?.on('close', () => bridge.push(null)); websocket?.on('error', error => bridge.destroy(error));
  const client = tls.connect({ socket: bridge, servername: 'proxy.test.invalid', ca: cert, rejectUnauthorized: true });
  const chunks = [];
  client.on('secureConnect', () => { authorized = client.authorized; client.write('GET /payload HTTP/1.1\r\nHost: proxy.test.invalid\r\nConnection: close\r\n\r\n'); });
  client.on('data', chunk => chunks.push(chunk));
  try {
    await deadline(new Promise((resolve, reject) => { client.once('end', resolve); client.once('error', reject); }), `${protocol}/${layout} TLS request stalled`);
    assert.equal(authorized, true, 'The trusted fallback must complete a real TLS handshake');
    const response = Buffer.concat(chunks), boundary = response.indexOf('\r\n\r\n');
    assert.match(response.subarray(0, boundary).toString(), /^HTTP\/1\.1 200 OK\r\n/);
    assert.equal(hash(response.subarray(boundary + 4)), hash(body));
    assert.equal(hello.length, 5 + hello.readUInt16BE(3)); assert.equal(canReplayInitialData(hello), true);
    const sessions = records.slice(start), refused = sessions.filter(record => record.mode === 'direct');
    assert.equal(refused.length, 1); assert.deepEqual(Buffer.concat(refused[0].bytes), hello, 'The refused route must receive only ClientHello, never GET/application bytes');
    assert.equal(sessions.filter(record => record.mode === 'fallback').length, 1);
    assert.match(Buffer.concat(sessions.find(record => record.mode === 'fallback').application).toString(), /^GET \/payload /);
  } finally {
    client.destroy(); websocket?.terminate(); try { uploader?.close(); } catch {}
    try { await responseReader?.cancel(); } catch {} try { await receiveTask; } catch {}
  }
}
for (const layout of ['combined', 'separate', 'partial-first', 'fragmented']) {
  test(`WS real TLS fallback survives ${layout} initial ClientHello framing`, { timeout: 10000 }, () => requestThroughTunnel('ws', layout));
}
for (const protocol of ['gun', 'multi']) {
  test(`gRPC ${protocol} real TLS fallback survives separate handshake and fragmented ClientHello`, { timeout: 10000 }, () => requestThroughTunnel(protocol, 'fragmented'));
}
test('initial replay rejects application data, POST and a ClientHello followed by an early application record', () => {
  assert.ok(capturedHello?.length > 100); assert.equal(canReplayInitialData(capturedHello), true);
  assert.equal(canReplayInitialData(Buffer.from('POST /messages HTTP/1.1\r\nContent-Length: 1\r\n\r\nx')), false);
  const application = Buffer.from([23, 3, 3, 0, 1, 0]);
  assert.equal(canReplayInitialData(application), false); assert.equal(canReplayInitialData(Buffer.concat([capturedHello, application])), false);
});
test('ClientHello capture is bounded across every split and becomes permanently unavailable after subsequent data or release', () => {
  for (let split = 0; split <= capturedHello.length; split++) {
    const tracker = createInitialReplayTracker(capturedHello.subarray(0, split));
    assert.equal(tracker.append(capturedHello.subarray(split)), true);
    assert.equal(tracker.replayable, true); assert.deepEqual(Buffer.from(tracker.data), capturedHello);
    assert.equal(tracker.append(Uint8Array.of(23)), false, 'Any byte after ClientHello forbids replay');
    assert.equal(tracker.replayable, false); assert.equal(tracker.bufferedBytes, 0);
    assert.equal(tracker.append(capturedHello), false, 'A rejected stream cannot become replayable again');
  }
  const tracker = createInitialReplayTracker(capturedHello.subarray(0, 20));
  assert.equal(tracker.replayable, false); tracker.stop();
  assert.equal(tracker.bufferedBytes, 0); assert.equal(tracker.append(capturedHello.subarray(20)), false);
  const oversized = createInitialReplayTracker();
  assert.equal(oversized.append(new Uint8Array(MAX_INITIAL_TLS_BYTES + 1)), false); assert.equal(oversized.bufferedBytes, 0);
});
test('a ClientHello offering early_data is ineligible even before its separate application record arrives', () => {
  let offset = 43; offset += 1 + capturedHello[offset];
  offset += 2 + capturedHello.readUInt16BE(offset); offset += 1 + capturedHello[offset];
  const offered = Buffer.concat([capturedHello, Buffer.from([0, 42, 0, 0])]);
  offered.writeUInt16BE(offered.length - 5, 3); offered.writeUIntBE(offered.length - 9, 6, 3);
  offered.writeUInt16BE(capturedHello.readUInt16BE(offset) + 4, offset);
  assert.equal(canReplayInitialData(offered), false);
  const tracker = createInitialReplayTracker(offered.subarray(0, 20));
  assert.equal(tracker.append(offered.subarray(20)), false); assert.equal(tracker.bufferedBytes, 0);
});
