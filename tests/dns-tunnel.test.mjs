// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Production WS/gRPC/XHTTP UDP paths, with every resolver connection redirected
// to a controlled loopback TCP DNS fixture. No external endpoint is contacted.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { decodeHunk } from '../src/grpc.js';
import { encodeDNSFrame } from '../src/dns-udp.js';

const uuid = '00000000-0000-4000-8000-000000000001';
const root = fileURLToPath(new URL('..', import.meta.url));
const sockets = new Set(), queries = [];
let server, relayServer, mf;
const relayRecords = [];
const wrapper = `
import worker from './dist/_worker.js';
import { connect } from 'cloudflare:sockets';
const cancellations = new Map();
export default { async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/fixture/cancel') {
    const cancel = cancellations.get(url.searchParams.get('session'));
    if (!cancel) return new Response('Unknown DNS session', { status: 404 });
    await cancel();
    return new Response('cancelled');
  }
  Object.defineProperty(request, 'cf', { value: { colo: 'TEST', asn: 0, country: 'XX' } });
  Object.defineProperty(request, 'fetcher', { value: { connect(options, init) {
    const dns = options.hostname === '8.8.4.4' && options.port === 53;
    const relay = options.hostname === 'relay.example.com' && options.port === 443;
    if (!dns && !relay) throw new Error('Unexpected destination in DNS regression test');
    return connect({ hostname: '127.0.0.1', port: Number(relay ? env.RELAY_PORT : env.FIXTURE_PORT) }, init);
  } } });
  const response = await worker.fetch(request, env, ctx);
  const session = url.searchParams.get('session');
  if (!session || !response.body) return response;
  const upstream = response.body.getReader();
  cancellations.set(session, () => upstream.cancel(new Error('Fixture cancelled production response')));
  return new Response(new ReadableStream({
    async pull(controller) {
      try { const { done, value } = await upstream.read(); if (done) controller.close(); else controller.enqueue(value); }
      catch (error) { controller.error(error); }
    },
    cancel(reason) { return upstream.cancel(reason); },
  }), { status: response.status, headers: response.headers });
} };
`;
const query = id => Buffer.from([id >> 8, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
const response = id => Buffer.from([id >> 8, id & 255, 0x81, 0x80, 0, 1, 0, 0, 0, 0, 0, 0]);
const dnsFrame = payload => Buffer.from(encodeDNSFrame(payload));
const address = Buffer.from([1, 8, 8, 4, 4, 0, 53]);
const trojanFrame = payload => Buffer.concat([address, Buffer.from([payload.length >> 8, payload.length & 255, 13, 10]), payload]);
function handshake(protocol, payload) {
  return protocol === 'vless' ? Buffer.concat([
    Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'), Buffer.from([0, 2, 0, 53, 1, 8, 8, 4, 4]), payload,
  ]) : Buffer.concat([
    Buffer.from(createHash('sha224').update(uuid).digest('hex') + '\r\n'), Buffer.from([3]), address, Buffer.from([13, 10]), payload,
  ]);
}
function deadline(promise, label, ms = 3000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })])
    .finally(() => clearTimeout(timer));
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  for (let index = 0; index < 100; index++) { if (predicate()) return; await pause(10); }
  assert.fail(label);
}
function varint(value) {
  const result = [];
  while (value > 127) { result.push((value & 127) | 128); value >>>= 7; }
  result.push(value); return Buffer.from(result);
}
function grpcFrame(parts) {
  const message = Buffer.concat(parts.flatMap(part => [Buffer.from([10]), varint(part.length), part]));
  const header = Buffer.alloc(5); header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

before(async () => {
  server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
        const size = pending.readUInt16BE(0), payload = pending.subarray(2, 2 + size);
        pending = pending.subarray(2 + size); queries.push(Buffer.from(payload));
        const id = payload.readUInt16BE(0);
        if (id === 65535) continue; // Stalled resolver, used to prove cancellation cleanup.
        const answer = dnsFrame(response(id));
        socket.write(answer.subarray(0, 1));
        setImmediate(() => { if (!socket.destroyed) socket.write(answer.subarray(1, 6));
          setImmediate(() => { if (!socket.destroyed) socket.write(answer.subarray(6)); }); });
        // Deliberately leave TCP open: the relay must return at the DNS boundary.
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  relayServer = net.createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); const record = []; relayRecords.push(record);
    socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let pending = Buffer.alloc(0), authenticated = false;
    socket.on('data', chunk => {
      record.push(Buffer.from(chunk));
      if (authenticated) { socket.write(chunk); return; }
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 68) return;
      authenticated = true; socket.write(pending.subarray(68)); pending = Buffer.alloc(0);
    });
    socket.on('end', () => { socket.end(Buffer.from('relay-after-fin')); });
  });
  await new Promise(resolve => relayServer.listen(0, '127.0.0.1', resolve));
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: root, modules: [
      { type: 'ESModule', path: `${root}/dns-tunnel-fixture.mjs`, contents: wrapper },
      { type: 'ESModule', path: `${root}/dist/_worker.js` },
    ], compatibilityDate: '2025-11-04', cf: { colo: 'TEST', asn: 0, country: 'XX' },
    bindings: { ADMIN: 'dns-local-fixture', UUID: uuid, OFF_LOG: 'true', FIXTURE_PORT: String(server.address().port), RELAY_PORT: String(relayServer.address().port) },
    outboundService: () => { throw new Error('External fetch forbidden by DNS fixture'); },
  }));
  await mf.ready;
});
after(async () => {
  if (mf) await mf.dispose();
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise(resolve => server.close(resolve));
  if (relayServer) await new Promise(resolve => relayServer.close(resolve));
});

let nextSession = 0;
async function openTunnel(transport, initialParts, relay = false) {
  const session = String(++nextSession);
  let pending = Buffer.alloc(0), grpcPending = Buffer.alloc(0), failure, closed = false, waiting;
  const decode = value => {
    if (transport === 'ws' || transport === 'xhttp') return value;
    grpcPending = Buffer.concat([grpcPending, value]);
    const output = [];
    while (grpcPending.length >= 5 && grpcPending.length >= 5 + grpcPending.readUInt32BE(1)) {
      const length = grpcPending.readUInt32BE(1);
      output.push(Buffer.from(decodeHunk(grpcPending.subarray(5, 5 + length))));
      grpcPending = grpcPending.subarray(5 + length);
    }
    return Buffer.concat(output);
  };
  let upload, ws, reader;
  const send = part => transport === 'ws' ? ws.send(part) : upload.enqueue(
    transport.startsWith('grpc') ? grpcFrame(transport === 'grpc-multi' ? [part.subarray(0, 1), part.subarray(1)] : [part]) : part);
  if (transport === 'ws') {
    const result = await mf.dispatchFetch(`https://dns.example.com/${relay ? 'trojan=relay.example.com:443' : ''}`, { headers: { Upgrade: 'websocket' } });
    ws = result.webSocket; ws.accept();
    ws.addEventListener('message', event => { pending = Buffer.concat([pending, Buffer.from(event.data)]); waiting?.(); });
    ws.addEventListener('close', () => { closed = true; waiting?.(); });
    ws.addEventListener('error', () => { failure = new Error('DNS websocket error'); waiting?.(); });
    for (const part of initialParts) send(part);
  } else {
    const body = new ReadableStream({ start(controller) { upload = controller; } });
    for (const part of initialParts) send(part);
    const result = await deadline(mf.dispatchFetch(`https://dns.example.com${relay ? '/trojan=relay.example.com:443' : ''}${transport === 'grpc-multi' ? '/qa/TunMulti' : transport.startsWith('grpc') ? '/qa/Tun' : '/qa'}?session=${session}`, {
      method: 'POST', headers: { 'Content-Type': transport.startsWith('grpc') ? 'application/grpc' : 'application/octet-stream' }, body, duplex: 'half',
    }), 'DNS initial HTTP response stalled');
    assert.equal(result.status, 200); reader = result.body.getReader();
  }
  return {
    send,
    finishUpload() { upload.close(); },
    async cancelProductionResponse() {
      const response = await mf.dispatchFetch(`https://dns.example.com/fixture/cancel?session=${session}`);
      assert.equal(response.status, 200);
    },
    async read(length) {
      return deadline((async () => {
        while (pending.length < length) {
          if (failure) throw failure;
          if (closed) throw new Error(`DNS tunnel closed after ${pending.length}/${length} bytes`);
          if (ws) await new Promise(resolve => { waiting = resolve; });
          else { const { done, value } = await reader.read(); if (done) throw new Error('DNS HTTP response closed'); pending = Buffer.concat([pending, decode(Buffer.from(value))]); }
        }
        const value = pending.subarray(0, length); pending = pending.subarray(length); return value;
      })(), `${transport} DNS response stalled`);
    },
    async close() { if (ws) { try { ws.close(); } catch {} } else { try { upload.close(); } catch {} await reader.cancel().catch(() => {}); } },
  };
}

for (const protocol of ['vless', 'trojan']) {
  for (const transport of ['ws', 'grpc-gun', 'grpc-multi', 'xhttp']) {
    test(`${protocol} ${transport}: fragmented DNS and consecutive queries complete while resolver TCP stays open`, { timeout: 10000 }, async () => {
      const frame = protocol === 'vless' ? dnsFrame : trojanFrame;
      // ID 10 deliberately equals message length - 2, which used to confuse the Trojan UDP/TCP heuristic.
      const first = frame(query(10)), second = frame(query(4919));
      const count = queries.length;
      const tunnel = await openTunnel(transport, [handshake(protocol, first.subarray(0, 1)), first.subarray(1, 4), first.subarray(4)]);
      try {
        const expected = Buffer.concat([protocol === 'vless' ? Buffer.from([0, 0]) : Buffer.alloc(0), frame(response(10))]);
        assert.deepEqual(await tunnel.read(expected.length), expected);
        for (let index = 0; index < second.length; index++) tunnel.send(second.subarray(index, index + 1));
        const next = frame(response(4919));
        assert.deepEqual(await tunnel.read(next.length), next);
        assert.deepEqual(queries.slice(count), [query(10), query(4919)]);
        await waitFor(() => sockets.size === 0, 'Completed DNS resolver sockets were not closed');
      } finally { await tunnel.close(); }
    });
  }
}

for (const transport of ['ws', 'grpc-gun', 'xhttp']) {
  test(`${transport}: cancelling an in-flight DNS lookup closes its resolver socket`, { timeout: 10000 }, async () => {
    const tunnel = await openTunnel(transport, [handshake('vless', dnsFrame(query(1)))]);
    await tunnel.read(2 + dnsFrame(response(1)).length);
    await waitFor(() => sockets.size === 0, 'First completed DNS query socket leaked');
    tunnel.send(dnsFrame(query(65535)));
    await waitFor(() => sockets.size > 0, 'Resolver query did not start');
    if (transport !== 'ws') await tunnel.cancelProductionResponse();
    await tunnel.close();
    await waitFor(() => sockets.size === 0, 'Cancelled DNS resolver socket leaked');
  });
}

for (const transport of ['ws', 'grpc-gun', 'xhttp']) {
  test(`Trojan UDP ${transport}: configured relay preserves raw framing and HTTP upload FIN keeps the reply direction open`, { timeout: 10000 }, async () => {
    const first = trojanFrame(query(10)), next = trojanFrame(query(55));
    const initial = handshake('trojan', first), count = relayRecords.length;
    const tunnel = await openTunnel(transport, [initial.subarray(0, 64), initial.subarray(64)], true);
    try {
      assert.deepEqual(await tunnel.read(first.length), first);
      tunnel.send(next.subarray(0, 3)); tunnel.send(next.subarray(3));
      assert.deepEqual(await tunnel.read(next.length), next);
      assert.deepEqual(Buffer.concat(relayRecords[count]), Buffer.concat([initial, next]));
      if (transport !== 'ws') {
        tunnel.finishUpload();
        assert.deepEqual(await tunnel.read(15), Buffer.from('relay-after-fin'));
        await waitFor(() => sockets.size === 0, 'Trojan UDP relay socket did not close after its reply');
      }
    } finally { await tunnel.close(); }
  });
}
