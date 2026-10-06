// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Actual workerd -> loopback TCP downloads exercise ongoing sessions, slow
// consumers, a real >30s idle period, upload FIN and downstream cancellation.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('..', import.meta.url));
const uuid = '00000000-0000-4000-8000-000000000001';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const payload = Buffer.alloc(16 * 1024 * 1024);
for (let index = 0; index < payload.length; index++) payload[index] = index % 251;
const trailer = Buffer.alloc(64 * 1024, 0xa7);
const expectedHash = createHash('sha256').update(payload).update(trailer).digest('hex');
const records = [], sockets = new Set(), timers = new Set();
let server, mf, fixtureDir, tcpPort, workerURL;

function later(callback, ms) {
  const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
  timers.add(timer);
  return timer;
}

function deadline(promise, label, ms = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })])
    .finally(() => clearTimeout(timer));
}

async function eventually(check, label, ms = 5000) {
  await deadline((async () => { while (!check()) await pause(10); })(), label, ms);
}

function handshake(command) {
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, tcpPort >> 8, tcpPort & 255, 1, 127, 0, 0, 1]), Buffer.from(`${command}\n`)]);
}

function checksum() {
  const hash = createHash('sha256');
  let bytes = 0, header = 0, firstFinishedAt = 0, resumedAt = 0;
  return {
    push(chunk) {
      chunk = Buffer.from(chunk);
      while (header < 2 && chunk.length) {
        assert.equal(chunk[0], 0, 'VLESS response header is emitted once');
        header++; chunk = chunk.subarray(1);
      }
      if (!chunk.length) return;
      if (bytes >= payload.length && !resumedAt) resumedAt = Date.now();
      hash.update(chunk); bytes += chunk.length;
      if (bytes >= payload.length && !firstFinishedAt) firstFinishedAt = Date.now();
    },
    get bytes() { return bytes; },
    verify() {
      assert.equal(header, 2);
      assert.equal(bytes, payload.length + trailer.length);
      assert.equal(hash.digest('hex'), expectedHash, 'Every download byte must arrive once and in order');
      assert.ok(resumedAt - firstFinishedAt >= 30000, 'The tunnel must survive a real idle period beyond 30 seconds');
    },
  };
}

before(async () => {
  server = net.createServer({ allowHalfOpen: true }, socket => {
    const record = { command: null, bytesQueued: 0, uploadEnded: false, closed: false, resumed: false };
    records.push(record); sockets.add(socket);
    socket.setNoDelay(true);
    let pending = Buffer.alloc(0);
    const finish = () => { if (!socket.destroyed && !record.resumed) { record.resumed = true; socket.end(trailer); } };
    record.resumeDownload = finish;
    socket.on('error', () => {});
    socket.on('close', () => { record.closed = true; sockets.delete(socket); });
    socket.on('end', () => {
      record.uploadEnded = true;
      // allowHalfOpen retains the deliberate XHTTP delayed response, but a
      // cancelled fixture must acknowledge the Worker's FIN instead of leaving
      // the server itself in CLOSE_WAIT forever.
      if (record.command === 'cancel') socket.end();
    });
    socket.on('data', data => {
      pending = Buffer.concat([pending, data]);
      while (pending.includes(10)) {
        const end = pending.indexOf(10), command = pending.subarray(0, end).toString();
        pending = pending.subarray(end + 1);
        if (command === 'resume') { finish(); continue; }
        if (record.command) continue;
        record.command = command;
        void (async () => {
          for (let offset = 0; offset < payload.length && !socket.destroyed; offset += 64 * 1024) {
            const chunk = payload.subarray(offset, offset + 64 * 1024);
            record.bytesQueued += chunk.length;
            if (!socket.write(chunk)) {
              await new Promise(resolve => {
                const settled = () => { socket.removeListener('drain', settled); socket.removeListener('close', settled); resolve(); };
                socket.once('drain', settled); socket.once('close', settled);
              });
            }
            if (command !== 'backpressure') await pause(2);
          }
          if (socket.destroyed) return;
          if (command === 'backpressure') socket.end();
          // ws-idle resumes only after a new client upload; cancel stays open.
        })().catch(() => { socket.destroy(); });
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); tcpPort = server.address().port;
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'brclio-long-connection-'));
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
  if (new URL(request.url).pathname === '/fixture-state') return Response.json({ uploadCancelled });
  if (request.headers.has('x-fixture-pending-upload')) {
    const bytes = Uint8Array.from(atob(request.headers.get('x-fixture-pending-upload')), c => c.charCodeAt(0));
    request = new Request(request.url, { method: 'POST', headers: request.headers,
      body: new ReadableStream({ start(c) { c.enqueue(bytes); }, cancel() { uploadCancelled++; } }), duplex: 'half' });
  }
  Object.defineProperty(request, 'cf', { value: { colo: 'TEST', asn: 0 } });
  Object.defineProperty(request, 'fetcher', { value: { connect(options, init) {
    if (options.hostname !== '127.0.0.1' || options.port !== Number(env.FIXTURE_PORT)) throw Error('Unexpected fixture destination');
    return connect(options, init);
  } } });
  const response = await worker.fetch(request, env, ctx);
  if (request.headers.has('x-fixture-hold-response')) await new Promise(resolve => setTimeout(resolve, 180));
  if (request.headers.has('x-fixture-cancel-response')) {
    const reader = response.body.getReader();
    let bytes = 0;
    while (bytes < 65536) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; }
    await reader.cancel('fixture download cancelled');
    return Response.json({ uploadCancelled, bytes });
  }
  return response;
} };
`);
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: fixtureDir, modules: [
      { type: 'ESModule', path: path.join(fixtureDir, 'entry.mjs') },
      { type: 'ESModule', path: path.join(fixtureDir, 'worker.mjs') },
    ],
    compatibilityDate: '2026-09-01',
    bindings: { ADMIN: 'fixture-password', UUID: uuid, OFF_LOG: 'true', FIXTURE_PORT: String(tcpPort),
      TCP_CONCURRENT_DIAL: '1', PROXY_CONCURRENT_DIAL: '1' },
  }));
  workerURL = await mf.ready;
});

after(async () => {
  for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  await mf?.dispose();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

async function websocketDownload() {
  const address = new URL('/tunnel', workerURL); address.protocol = 'ws:';
  const ws = new WebSocket(address);
  const sum = checksum();
  let resumed = false, nextPause = 1024 * 1024;
  const completed = new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('message', data => {
      try {
        sum.push(data);
        if (sum.bytes >= nextPause && sum.bytes < payload.length) {
          nextPause += 1024 * 1024;
          // Pause the actual TCP receive direction, not just a JS queue.
          ws._socket.pause(); later(() => ws._socket?.resume(), 20);
        }
        if (sum.bytes >= payload.length && !resumed) {
          resumed = true;
          later(() => { if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from('resume\n')); }, 31000);
        }
      } catch (error) { reject(error); ws.terminate(); }
    });
    ws.on('close', () => { try { sum.verify(); resolve(); } catch (error) { reject(error); } });
  });
  await once(ws, 'open'); ws.send(handshake('ws-idle'));
  try { await deadline(completed, 'WS 16MiB download/idle recovery failed', 50000); }
  catch (error) { error.message += ` (${sum.bytes} bytes, targets=${JSON.stringify(records.map(({ command, bytesQueued, uploadEnded, closed, resumed }) => ({ command, bytesQueued, uploadEnded, closed, resumed })))})`; throw error; }
  finally { ws.terminate(); }
}

async function xhttpDownload() {
  const response = await mf.dispatchFetch('https://fixture.example/tunnel', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: handshake('xhttp-idle'), duplex: 'half',
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), sum = checksum();
  let nextPause = 1024 * 1024, resumed = false;
  try {
    await deadline((async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sum.push(value);
        if (sum.bytes >= nextPause && sum.bytes < payload.length) { nextPause += 1024 * 1024; await pause(20); }
        if (sum.bytes >= payload.length && !resumed) {
          resumed = true;
          // Start the idle interval after the slow client has consumed phase
          // one, so a loaded CI host cannot shorten the observed quiet period.
          const target = records.find(value => value.command === 'xhttp-idle');
          later(() => target.resumeDownload(), 31000);
        }
      }
    })(), 'XHTTP 16MiB download/idle recovery failed', 50000);
    sum.verify();
  } finally { await reader.cancel().catch(() => {}); }
}

test('real WS and XHTTP downloads preserve 16MiB checksums through slow reads and a 31-second idle recovery', { timeout: 60000 }, async () => {
  const initial = records.length;
  await Promise.all([websocketDownload(), xhttpDownload()]);
  const sessions = records.slice(initial);
  assert.equal(sessions.length, 2, 'An established long session must not redial or replay application bytes');
  assert.deepEqual(sessions.map(value => value.command).sort(), ['ws-idle', 'xhttp-idle']);
  await eventually(() => sessions.every(value => value.closed), 'Completed long downloads left TCP sockets open');
  assert.equal(sessions.find(value => value.command === 'xhttp-idle').uploadEnded, true, 'Finite XHTTP upload must send FIN without cutting off the download');
});

test('an unread XHTTP download applies TCP backpressure before resuming without byte loss', { timeout: 10000 }, async () => {
  const initial = records.length;
  const responseTask = mf.dispatchFetch('https://fixture.example/tunnel', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-fixture-hold-response': '1' },
    body: handshake('backpressure'), duplex: 'half',
  });
  await eventually(() => records.length > initial, 'Backpressure fixture never connected');
  await pause(70);
  assert.ok(records[initial].bytesQueued < payload.length, 'A paused response must not drain all 16MiB into the Worker');
  const response = await responseTask;
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes.subarray(0, 2), Buffer.from([0, 0]));
  assert.equal(bytes.length, payload.length + 2);
  assert.equal(createHash('sha256').update(bytes.subarray(2)).digest('hex'), createHash('sha256').update(payload).digest('hex'));
  await eventually(() => records[initial].closed, 'Resumed XHTTP left its destination open');
});

test('cancelling a live XHTTP download releases its TCP socket and pending upload producer', { timeout: 10000 }, async () => {
  const initial = records.length;
  const before = await (await mf.dispatchFetch('https://fixture.example/fixture-state')).json();
  const response = await deadline(mf.dispatchFetch('https://fixture.example/tunnel', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream',
      'x-fixture-pending-upload': handshake('cancel').toString('base64'), 'x-fixture-cancel-response': '1' },
    body: '', duplex: 'half',
  }), 'XHTTP cancellation remained blocked');
  const result = await response.json();
  assert.ok(result.bytes >= 65536, 'The destination must be actively sending before cancellation');
  await eventually(() => records[initial]?.closed, 'XHTTP cancellation left destination TCP open');
  assert.ok(records[initial].bytesQueued < payload.length, 'Cancellation must interrupt an active download');
  await deadline((async () => {
    while (true) {
      const afterState = await (await mf.dispatchFetch('https://fixture.example/fixture-state')).json();
      if (afterState.uploadCancelled === before.uploadCancelled + 1) return;
      await pause(10);
    }
  })(), 'Response cancellation must release the unfinished upload', 1000);
});

test('closing a live WebSocket download promptly releases its destination TCP socket', { timeout: 10000 }, async () => {
  const initial = records.length;
  const address = new URL('/tunnel', workerURL); address.protocol = 'ws:';
  const ws = new WebSocket(address);
  ws.on('error', () => {});
  await once(ws, 'open');
  const first = once(ws, 'message'); ws.send(handshake('cancel'));
  await deadline(first, 'WS cancellation fixture never delivered download bytes');
  ws.close();
  try { await eventually(() => records[initial]?.closed, 'WebSocket close left destination TCP open'); }
  catch (error) { error.message += ` (${JSON.stringify(records[initial])}, clientReadyState=${ws.readyState})`; throw error; }
  finally { ws.terminate(); }
  assert.ok(records[initial].bytesQueued < payload.length, 'WebSocket close must interrupt an active download');
});
