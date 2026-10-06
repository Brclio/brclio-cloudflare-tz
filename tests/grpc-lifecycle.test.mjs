// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Real loopback TCP verifies FIN, delayed replies and cancellation independently
// of the production build, so parallel development never races dist output.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const uuid = '00000000-0000-4000-8000-000000000001';
const root = fileURLToPath(new URL('..', import.meta.url));
const sockets = new Set();
let mf, server, fixtureDir, tcpPort;
let accepted = 0, ended = 0, closed = 0;
const bulkChunk = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 251));
const bulkChunks = 256; // 16 MiB, well beyond stream and kernel buffers.

function frame(payload) {
  assert.ok(payload.length < 128);
  const message = Buffer.concat([Buffer.from([10, payload.length]), payload]);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

function handshake(payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, tcpPort >> 8, tcpPort & 255, 1, 127, 0, 0, 1]), payload]);
}

function deadline(promise, label, ms = 3000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })])
    .finally(() => clearTimeout(timer));
}

async function eventually(check, label) {
  await deadline((async () => {
    while (!check()) await new Promise(resolve => setTimeout(resolve, 10));
  })(), label);
}

before(async () => {
  server = net.createServer({ allowHalfOpen: true }, socket => {
    accepted++;
    sockets.add(socket);
    const parts = [];
    let bulkStarted = false;
    socket.on('data', data => {
      parts.push(data);
      if (Buffer.concat(parts).toString() === 'cancel') socket.write('connected');
      if (Buffer.concat(parts).toString() === 'peer-eof') socket.end('final response');
      if (!bulkStarted && Buffer.concat(parts).toString() === 'bulk') {
        bulkStarted = true;
        void (async () => {
          for (let index = 0; index < bulkChunks && !socket.destroyed; index++) {
            await new Promise((resolve, reject) => socket.write(bulkChunk, error => error ? reject(error) : resolve()));
          }
          if (!socket.destroyed) socket.end();
        })().catch(() => {});
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { sockets.delete(socket); closed++; });
    socket.on('end', () => {
      ended++;
      const payload = Buffer.concat(parts);
      // Reply only after the peer has finished its write direction. Immediate
      // echoes cannot detect a Worker that closes the entire socket at EOF.
      if (payload.toString().startsWith('delayed:')) {
        setTimeout(() => { if (!socket.destroyed) socket.end(Buffer.concat([Buffer.from('reply:'), payload])); }, 40);
      } else if (!bulkStarted) socket.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  tcpPort = server.address().port;
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'brclio-grpc-lifecycle-'));
  await build({
    entryPoints: [path.join(root, 'src/worker.js')], outfile: path.join(fixtureDir, 'worker.mjs'), bundle: true,
    format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:sockets'],
    plugins: [{ name: 'fixture-assets', setup(b) {
      b.onResolve({ filter: /^brclio:/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  await writeFile(path.join(fixtureDir, 'entry.mjs'), `
import worker from './worker.mjs';
import { connect } from 'cloudflare:sockets';
let uploadCancelled = 0;
export default { async fetch(request, env, ctx) {
  let deliveredBytes = 0;
  let cancelledReads = 0;
  if (new URL(request.url).pathname === '/fixture-state') return Response.json({ uploadCancelled });
  if (request.headers.has('x-fixture-pending-upload')) {
    const initial = Uint8Array.from(atob(request.headers.get('x-fixture-pending-upload')), c => c.charCodeAt(0));
    request = new Request(request.url, { method: 'POST', headers: request.headers,
      body: new ReadableStream({ start(c) { c.enqueue(initial); }, cancel() { uploadCancelled++; } }), duplex: 'half' });
  }
  Object.defineProperty(request, 'cf', { value: { colo: 'TEST', asn: 0 } });
  Object.defineProperty(request, 'fetcher', { value: { connect(options, init) {
    if (options.hostname !== '127.0.0.1' || options.port !== Number(env.FIXTURE_PORT)) throw Error('Unexpected fixture destination');
    const socket = connect(options, init);
    if (!request.headers.has('x-fixture-slow-response')) return socket;
    const reader = socket.readable.getReader();
    return { opened: socket.opened, closed: socket.closed, writable: socket.writable, close: () => socket.close(),
      readable: new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else { deliveredBytes += value.byteLength; controller.enqueue(value); }
        },
        async cancel(reason) { cancelledReads++; try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
      }, { highWaterMark: 0 }) };
  } } });
  const response = await worker.fetch(request, env, ctx);
  if (request.headers.has('x-fixture-slow-response')) {
    // Pause inside workerd: the dispatchFetch HTTP bridge has its own buffering
    // and cannot measure the production ReadableStream's backpressure.
    await new Promise(resolve => setTimeout(resolve, 100));
    const pausedBytes = deliveredBytes;
    if (request.headers.get('x-fixture-slow-response') === 'cancel') {
      await response.body.cancel('paused download cancelled');
      for (let attempt = 0; attempt < 50 && !cancelledReads; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json({ pausedBytes, uploadCancelled, cancelledReads });
    }
    const headers = new Headers(response.headers);
    headers.set('x-fixture-paused-bytes', String(pausedBytes));
    return new Response(response.body, { status: response.status, headers });
  }
  if (request.headers.has('x-fixture-cancel-response')) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw Error('Tunnel closed before cancellation');
      if (new TextDecoder().decode(value).includes('connected')) break;
    }
    await reader.cancel('fixture cancelled');
    return Response.json({ uploadCancelled });
  }
  if (request.headers.has('x-fixture-inspect-response')) {
    try { await response.arrayBuffer(); return Response.json({ error: null }); }
    catch (error) { return Response.json({ error: error.message }); }
  }
  return response;
} };
`);
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: fixtureDir, modules: [
      { type: 'ESModule', path: path.join(fixtureDir, 'entry.mjs') },
      { type: 'ESModule', path: path.join(fixtureDir, 'worker.mjs') },
    ],
    compatibilityDate: '2025-11-04', kvNamespaces: ['KV'],
    bindings: { ADMIN: 'fixture-password', UUID: uuid, OFF_LOG: 'true', FIXTURE_PORT: String(tcpPort),
      PROXYIP: `127.0.0.1:${tcpPort}`, TCP_CONCURRENT_DIAL: '1', PROXY_CONCURRENT_DIAL: '1' },
  }));
  await mf.ready;
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await mf?.dispose();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

async function open(body, headers = {}) {
  const response = await deadline(mf.dispatchFetch('https://fixture.example/grpc/Tun', {
    method: 'POST', headers: { 'Content-Type': 'application/grpc', ...headers }, body, duplex: 'half',
  }), 'gRPC response headers timed out');
  return response;
}

function decoded(bytes) {
  const parts = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    assert.ok(bytes.length - cursor >= 5);
    const size = bytes.readUInt32BE(cursor + 1);
    assert.ok(cursor + 5 + size <= bytes.length);
    const message = bytes.subarray(cursor + 5, cursor + 5 + size);
    assert.equal(message[0], 10);
    let offset = 1, length = 0, shift = 0, byte;
    do { byte = message[offset++]; length += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    assert.equal(length, message.length - offset);
    parts.push(message.subarray(offset));
    cursor += 5 + size;
  }
  return Buffer.concat(parts);
}

test('gRPC finite upload half-closes TCP and preserves the delayed response through remote EOF', { timeout: 10000 }, async () => {
  const beforeAccepted = accepted, beforeEnded = ended, beforeClosed = closed;
  const firstPayload = Buffer.from('delayed:finite upload');
  const continuation = Buffer.from(' plus queued continuation');
  const payload = Buffer.concat([firstPayload, continuation]);
  const response = await open(Buffer.concat([frame(handshake(firstPayload)), frame(continuation)]));
  const bytes = Buffer.from(await deadline(response.arrayBuffer(), 'Delayed response never completed'));
  assert.deepEqual(decoded(bytes), Buffer.concat([Buffer.from([0, 0]), Buffer.from('reply:'), payload]));
  await eventually(() => ended === beforeEnded + 1 && closed === beforeClosed + 1, 'TCP FIN/close not observed');
  assert.equal(accepted, beforeAccepted + 1, 'Completed upload must not retry its initial bytes');
});

test('gRPC paused download bounds TCP reads then resumes 16 MiB with the exact checksum', { timeout: 15000 }, async () => {
  const response = await open(Buffer.alloc(0), {
    'x-fixture-pending-upload': frame(handshake(Buffer.from('bulk'))).toString('base64'),
    'x-fixture-slow-response': 'resume',
  });
  const pausedBytes = Number(response.headers.get('x-fixture-paused-bytes'));
  if (pausedBytes > 256 * 1024) await response.body.cancel();
  assert.ok(pausedBytes <= 256 * 1024,
    'A paused consumer must stop TCP reads after the byte high water mark plus in-flight chunks');
  const plain = decoded(Buffer.from(await deadline(response.arrayBuffer(), 'Paused download never resumed', 10000)));
  assert.deepEqual(plain.subarray(0, 2), Buffer.from([0, 0]));
  assert.equal(plain.length, 2 + bulkChunk.length * bulkChunks);
  const expected = createHash('sha256');
  for (let index = 0; index < bulkChunks; index++) expected.update(bulkChunk);
  assert.equal(createHash('sha256').update(plain.subarray(2)).digest('hex'), expected.digest('hex'));
});

test('gRPC cancellation releases a send blocked by a paused download', { timeout: 10000 }, async () => {
  const beforeClosed = closed;
  const statsBefore = await (await mf.dispatchFetch('https://fixture.example/fixture-state')).json();
  const response = await open(Buffer.alloc(0), {
    'x-fixture-pending-upload': frame(handshake(Buffer.from('bulk'))).toString('base64'),
    'x-fixture-slow-response': 'cancel',
  });
  const stats = await response.json();
  assert.ok(stats.pausedBytes <= 256 * 1024, 'The download must be blocked at cancellation');
  assert.equal(stats.cancelledReads, 1, 'The blocked send must settle so the downlink pump can cancel/release its reader');
  assert.equal(stats.uploadCancelled, statsBefore.uploadCancelled + 1);
  await eventually(() => closed >= beforeClosed + 1, 'Backpressured cancellation left TCP open');
});

test('gRPC destination EOF flushes its final response and cancels the unfinished upload', { timeout: 10000 }, async () => {
  const beforeClosed = closed;
  const statsBefore = await (await mf.dispatchFetch('https://fixture.example/fixture-state')).json();
  const response = await open(Buffer.alloc(0), {
    'x-fixture-pending-upload': frame(handshake(Buffer.from('peer-eof'))).toString('base64'),
  });
  const bytes = Buffer.from(await deadline(response.arrayBuffer(), 'Remote EOF did not finish the response'));
  assert.deepEqual(decoded(bytes), Buffer.concat([Buffer.from([0, 0]), Buffer.from('final response')]));
  await eventually(() => closed === beforeClosed + 1, 'Remote EOF left its socket open');
  const stats = await (await mf.dispatchFetch('https://fixture.example/fixture-state')).json();
  assert.equal(stats.uploadCancelled, statsBefore.uploadCancelled + 1, 'Remote EOF must cancel the upload producer');
});

test('gRPC finite upload does not replay its handshake when the peer ends without response data', { timeout: 10000 }, async () => {
  const beforeAccepted = accepted, beforeClosed = closed;
  const response = await open(frame(handshake()));
  assert.deepEqual(decoded(Buffer.from(await deadline(response.arrayBuffer(), 'Empty remote EOF never completed'))), Buffer.from([0, 0]));
  await eventually(() => closed >= beforeClosed + 1, 'Empty session did not close TCP');
  assert.equal(accepted, beforeAccepted + 1, 'Upload EOF must suppress the no-response retry');
});

test('gRPC EOF rejects a truncated envelope instead of reporting a successful empty response', { timeout: 10000 }, async () => {
  const beforeAccepted = accepted;
  const response = await open(frame(handshake()).subarray(0, 4), { 'x-fixture-inspect-response': '1' });
  assert.match((await response.json()).error || '', /Truncated gRPC/);
  assert.equal(accepted, beforeAccepted, 'An incomplete envelope must not dial');
});

test('gRPC EOF rejects an incomplete authenticated protocol header', { timeout: 10000 }, async () => {
  const beforeAccepted = accepted;
  const response = await open(frame(handshake().subarray(0, 18)), { 'x-fixture-inspect-response': '1' });
  assert.match((await response.json()).error || '', /Incomplete tunnel/);
  assert.equal(accepted, beforeAccepted, 'An incomplete protocol header must not dial');
});

test('gRPC response cancellation cancels a pending upload and closes the destination socket', { timeout: 10000 }, async () => {
  const beforeAccepted = accepted, beforeClosed = closed;
  const statsBefore = await (await mf.dispatchFetch('https://fixture.example/fixture-state')).json();
  const response = await open(Buffer.alloc(0), {
    'x-fixture-pending-upload': frame(handshake(Buffer.from('cancel'))).toString('base64'),
    'x-fixture-cancel-response': '1',
  });
  const result = await response.json();
  assert.equal(accepted, beforeAccepted + 1, 'Destination was connected before cancellation');
  assert.equal(result.uploadCancelled, statsBefore.uploadCancelled + 1);
  await eventually(() => closed === beforeClosed + 1, 'Cancelled tunnel left TCP socket open');
  await deadline((async () => {
    while (true) {
      const stats = await (await mf.dispatchFetch('https://fixture.example/fixture-state')).json();
      if (stats.uploadCancelled === statsBefore.uploadCancelled + 1) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  })(), 'Cancelled response left upload reader pending');
});
