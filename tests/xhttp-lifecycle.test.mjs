// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Request.signal cancellation is triggered inside workerd, so this test does
// not depend on Miniflare/Undici forwarding a disconnected HTTP client.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const uuid = '00000000-0000-4000-8000-000000000001';
const root = fileURLToPath(new URL('..', import.meta.url));
const sockets = new Set(), received = [], dnsRequests = [];
let mf, server, fixtureDir, releaseDNS;
const dnsGate = new Promise(resolve => { releaseDNS = resolve; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function deadline(promise, label, ms = 4000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function eventually(check, label) {
  await deadline((async () => { while (!check()) await pause(10); })(), label);
}
function handshake(host) {
  const name = Buffer.from(host);
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, 1, 187, 2, name.length]), name,
    Buffer.from('POST /messages HTTP/1.1\r\nContent-Length: 1\r\n\r\nx')]);
}

before(async () => {
  server = net.createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.on('data', data => { received.push(Buffer.from(data)); socket.write('connected'); });
    socket.on('end', () => socket.end());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'brclio-xhttp-lifecycle-'));
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
const sessions = new Map();
export default { async fetch(incoming, env, ctx) {
  const url = new URL(incoming.url), id = url.searchParams.get('session'), mode = url.searchParams.get('mode');
  if (url.pathname === '/fixture/abort') {
    const session = sessions.get(id);
    if (!session) return new Response('unknown session', { status: 404 });
    session.controller.abort(new Error('Fixture request aborted'));
    return Response.json(session.record);
  }
  if (url.pathname === '/fixture/state') return Response.json(sessions.get(id)?.record || {});
  const controller = new AbortController();
  const record = { dials: 0, closes: 0, uploadCancelled: 0, added: 0, removed: 0 };
  const initial = Uint8Array.from(atob(incoming.headers.get('x-fixture-handshake')), c => c.charCodeAt(0));
  const request = new Request(incoming.url, { method: 'POST', headers: incoming.headers, signal: controller.signal,
    body: new ReadableStream({ start(c) { c.enqueue(initial); if (mode === 'complete') c.close(); }, cancel() { record.uploadCancelled++; } }), duplex: 'half' });
  const add = request.signal.addEventListener.bind(request.signal), remove = request.signal.removeEventListener.bind(request.signal);
  request.signal.addEventListener = (...args) => { record.added++; return add(...args); };
  request.signal.removeEventListener = (...args) => { record.removed++; return remove(...args); };
  sessions.set(id, { controller, record });
  Object.defineProperty(request, 'cf', { value: { colo: 'TEST', asn: 0 } });
  Object.defineProperty(request, 'fetcher', { value: { connect(options, init) {
    if (!['dial.example.com', 'lookup.example.com', '192.0.2.4'].includes(options.hostname) || options.port !== 443) throw Error('Unexpected fixture destination');
    record.dials++;
    const socket = connect({ hostname: '127.0.0.1', port: Number(env.FIXTURE_PORT) }, init);
    return { readable: socket.readable, writable: socket.writable, closed: socket.closed,
      opened: mode === 'dial' ? socket.opened.then(() => new Promise(resolve => setTimeout(resolve, 150))) : socket.opened,
      close() { record.closes++; return socket.close(); } };
  } } });
  const response = await worker.fetch(request, { ...env, PRELOAD_RACE_DIAL: mode === 'lookup' ? 'true' : 'false' }, ctx);
  if (mode === 'complete') {
    const result = [...new Uint8Array(await response.arrayBuffer())];
    // pipeTo settles and runs the cleanup continuation after readable EOF.
    await new Promise(resolve => setTimeout(resolve, 0));
    return Response.json({ ...record, result });
  }
  if (mode === 'established') {
    const reader = response.body.getReader();
    let text = '';
    while (!text.includes('connected')) { const part = await reader.read(); if (part.done) throw Error('Closed before established'); text += new TextDecoder().decode(part.value); }
    controller.abort(new Error('Fixture established request aborted'));
    await reader.cancel().catch(() => {});
    return Response.json(record);
  }
  return response;
} };
`);
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: fixtureDir, modules: [
      { type: 'ESModule', path: path.join(fixtureDir, 'entry.mjs') },
      { type: 'ESModule', path: path.join(fixtureDir, 'worker.mjs') },
    ],
    compatibilityDate: '2025-11-04', cf: { colo: 'TEST', asn: 0 },
    bindings: { ADMIN: 'xhttp-local-fixture', UUID: uuid, OFF_LOG: 'true', FIXTURE_PORT: String(server.address().port), TCP_CONCURRENT_DIAL: '1' },
    outboundService: async request => {
      assert.equal(new URL(request.url).hostname, 'cloudflare-dns.com', 'Only the controlled DNS lookup is allowed');
      const wire = Buffer.from(await request.arrayBuffer()); dnsRequests.push(wire);
      await dnsGate;
      // Return a valid A answer after cancellation; this must not trigger a late dial.
      const answer = Buffer.from(wire); answer[2] = 0x81; answer[3] = 0x80;
      const type = wire.readUInt16BE(wire.length - 4);
      if (type !== 1) return new Response(answer);
      answer.writeUInt16BE(1, 6);
      return new Response(Buffer.concat([answer, Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 4])]));
    },
  }));
  await mf.ready;
});
after(async () => {
  releaseDNS();
  for (const socket of sockets) socket.destroy();
  if (mf) await mf.dispose();
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});
const state = async id => (await mf.dispatchFetch(`https://xhttp.example.com/fixture/state?session=${id}`)).json();
const abort = id => mf.dispatchFetch(`https://xhttp.example.com/fixture/abort?session=${id}`);
const start = (mode, id) => mf.dispatchFetch(`https://xhttp.example.com/qa?mode=${mode}&session=${id}`, {
  method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-fixture-handshake': handshake(mode === 'lookup' ? 'lookup.example.com' : 'dial.example.com').toString('base64') }, body: 'fixture body',
});

test('XHTTP Request.signal cancellation during delayed socket.opened closes the pending socket and writes no first payload', { timeout: 10000 }, async () => {
  const pending = start('dial', 'delayed-dial');
  await eventually(() => sockets.size === 1, 'Delayed dial did not start');
  await abort('delayed-dial');
  const response = await deadline(pending, 'Cancelled dial did not settle');
  assert.equal(response.status, 499);
  await eventually(() => sockets.size === 0, 'Cancelled pending socket leaked');
  assert.equal(received.length, 0, 'An aborted dial must never send the POST payload');
  const record = await state('delayed-dial');
  assert.equal(record.dials, 1); assert.ok(record.closes >= 1); assert.equal(record.uploadCancelled, 1);
  assert.equal(record.added, record.removed, 'The request abort listener must be removed after cancellation');
});

test('XHTTP cancellation before delayed DoH returns cannot dial or send stale application bytes', { timeout: 10000 }, async () => {
  const pending = start('lookup', 'delayed-lookup');
  await eventually(() => dnsRequests.length === 2, 'Preload A/AAAA lookups did not start');
  await abort('delayed-lookup');
  releaseDNS();
  const response = await deadline(pending, 'Cancelled lookup did not settle');
  assert.equal(response.status, 499);
  const record = await state('delayed-lookup');
  assert.equal(record.dials, 0); assert.equal(record.uploadCancelled, 1);
  assert.equal(received.length, 0); assert.equal(sockets.size, 0);
  assert.equal(record.added, record.removed, 'The request abort listener must be removed after cancellation');
});

test('XHTTP established Request.signal cancellation closes TCP, cancels pending upload and removes its listener', { timeout: 10000 }, async () => {
  const response = await deadline(start('established', 'established'), 'Established cancellation did not settle');
  assert.equal(response.status, 200);
  const record = await response.json();
  assert.equal(record.dials, 1); assert.ok(record.closes >= 1); assert.equal(record.uploadCancelled, 1);
  assert.equal(record.added, record.removed, 'The completed tunnel must release its request abort listener');
  await eventually(() => sockets.size === 0, 'Established cancelled TCP socket leaked');
});

test('XHTTP normal upload FIN drains the reply and removes its Request.signal listener', { timeout: 10000 }, async () => {
  const response = await deadline(start('complete', 'complete'), 'XHTTP normal completion did not settle');
  const record = await response.json();
  assert.deepEqual(Buffer.from(record.result), Buffer.concat([Buffer.from([0, 0]), Buffer.from('connected')]));
  assert.equal(record.dials, 1); assert.equal(record.uploadCancelled, 0);
  assert.equal(record.added, record.removed, 'Normal EOF must release the request abort listener');
  await eventually(() => sockets.size === 0, 'Completed XHTTP socket leaked');
});
