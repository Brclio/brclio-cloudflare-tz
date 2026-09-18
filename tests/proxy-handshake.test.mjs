// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Production bundle in workerd, speaking to controlled loopback SOCKS5/HTTP
// proxies. Fragmentation and handshake/application coalescing are intentional.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const uuid = '00000000-0000-4000-8000-000000000001';
const target = 'fixture.example.com';
const banner = Buffer.from('server-first greeting\n');
const sockets = new Set();
const outbound = [];
let mf;

before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
    compatibilityDate: '2025-11-04', cf: { colo: 'TEST', asn: 0, country: 'XX' },
    bindings: { ADMIN: 'local-handshake-password', UUID: uuid, OFF_LOG: 'true', TCP_CONCURRENT_DIAL: '1' },
    outboundService: request => { outbound.push(request.url); return new Response('External fetch blocked', { status: 599 }); },
  }));
  await mf.ready;
});
after(async () => {
  for (const socket of sockets) socket.destroy();
  if (mf) await mf.dispose();
  assert.deepEqual(outbound, []);
});

function deadline(promise, label, ms = 4000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })])
    .finally(() => clearTimeout(timer));
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function frame(payload) {
  const host = Buffer.from(target);
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'), Buffer.from([0, 1, 1, 187, 2, host.length]), host, payload]);
}
function receive(ws, length, send) {
  return deadline(new Promise((resolve, reject) => {
    const parts = []; let bytes = 0;
    const clean = () => { ws.removeEventListener('message', message); ws.removeEventListener('close', closed); ws.removeEventListener('error', failed); };
    const message = event => {
      const part = Buffer.from(event.data); parts.push(part); bytes += part.length;
      if (bytes >= length) { clean(); resolve(Buffer.concat(parts)); }
    };
    const closed = () => { clean(); reject(new Error(`Closed after ${bytes}/${length} bytes`)); };
    const failed = () => { clean(); reject(new Error('WebSocket failed')); };
    ws.addEventListener('message', message); ws.addEventListener('close', closed); ws.addEventListener('error', failed);
    send();
  }), 'Proxy handshake/echo did not complete');
}

async function fixture(kind, options = {}) {
  const records = { received: [], targets: [], premature: false, accepted: 0, errors: [] };
  const connections = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); connections.add(socket); records.accepted++;
    socket.setNoDelay(true);
    socket.on('close', () => { sockets.delete(socket); connections.delete(socket); });
    socket.on('error', () => {});
    let stage = 'handshake';
    socket.on('data', () => { if (stage === 'sending-connect') records.premature = true; });
    const reader = Readable.toWeb(socket).getReader();
    let pending = Buffer.alloc(0);
    const take = async count => {
      while (pending.length < count) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Client closed during proxy handshake');
        pending = Buffer.concat([pending, Buffer.from(value)]);
      }
      const part = pending.subarray(0, count); pending = pending.subarray(count); return part;
    };
    const sendPieces = async pieces => {
      for (let i = 0; i < pieces.length; i++) {
        socket.write(pieces[i]);
        if (i + 1 < pieces.length) await pause(20);
      }
    };
    const run = async () => {
      try {
        if (kind === 'socks5') {
          const greeting = await take(2); assert.equal(greeting[0], 5);
          const methods = await take(greeting[1]);
          const method = options.auth ? 2 : 0; assert.ok(methods.includes(method));
          const selection = Buffer.from([options.invalid === 'method-version' ? 4 : 5, method]);
          await sendPieces(options.split ? [selection.subarray(0, 1), selection.subarray(1)] : [selection]);
          if (options.invalid === 'method-version') { socket.end(); return; }
          if (options.auth) {
            const auth = await take(2); assert.equal(auth[0], 1);
            assert.equal((await take(auth[1])).toString(), 'user');
            const length = (await take(1))[0]; assert.equal((await take(length)).toString(), 'password');
            const result = Buffer.from([options.invalid === 'auth-version' ? 2 : 1, 0]);
            await sendPieces(options.split ? [result.subarray(0, 1), result.subarray(1)] : [result]);
            if (options.invalid === 'auth-version') { socket.end(); return; }
          }
          const connect = await take(5); assert.deepEqual([...connect.subarray(0, 4)], [5, 1, 0, 3]);
          const host = (await take(connect[4])).toString(); const port = (await take(2)).readUInt16BE();
          records.targets.push(`${host}:${port}`); assert.equal(host, target); assert.equal(port, 443);
          const address = options.address === 'domain' ? Buffer.from([3, 3, 98, 110, 100])
            : options.address === 'ipv6' ? Buffer.from([4, ...Array(15).fill(0), 1]) : Buffer.from([1, 127, 0, 0, 1]);
          let reply = Buffer.concat([Buffer.from([5, 0, 0]), address, Buffer.from([0, 80])]);
          if (options.invalid === 'reserved') reply[2] = 1;
          if (options.invalid === 'address-type') reply[3] = 9;
          if (options.invalid === 'reply-version') reply[0] = 4;
          if (options.invalid === 'truncated') reply = reply.subarray(0, reply.length - 1);
          stage = 'sending-connect';
          if (options.invalid) { socket.end(reply); return; }
          const trailing = options.banner ? banner : Buffer.alloc(0);
          await sendPieces(options.split
            ? [reply.subarray(0, 2), reply.subarray(2, 5), Buffer.concat([reply.subarray(5), trailing])]
            : [Buffer.concat([reply, trailing])]);
        } else {
          let request = Buffer.alloc(0);
          while (!request.includes('\r\n\r\n')) request = Buffer.concat([request, await take(1)]);
          assert.match(request.toString(), /^CONNECT fixture\.example\.com:443 HTTP\/1\.1\r\n/);
          records.targets.push(`${target}:443`);
          const response = Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n');
          stage = 'sending-connect';
          await sendPieces(options.split ? [response.subarray(0, 12), Buffer.concat([response.subarray(12), banner])]
            : [Buffer.concat([response, banner])]);
        }
        stage = 'application';
        for (;;) {
          if (pending.length) { records.received.push(Buffer.from(pending)); socket.write(pending); pending = Buffer.alloc(0); }
          const { done, value } = await reader.read();
          if (done) break;
          pending = Buffer.from(value);
        }
      } catch (error) {
        if (!options.invalid && !socket.destroyed) records.errors.push(error);
      } finally {
        try { reader.releaseLock(); } catch {}
      }
    };
    void run();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  const query = new URLSearchParams({ [kind]: `${options.auth ? 'user:password@' : ''}127.0.0.1:${port}`, globalproxy: '' });
  const response = await mf.dispatchFetch(`https://handshake.example.com/tunnel?${query}`, { headers: { Upgrade: 'websocket' } });
  assert.equal(response.status, 101); const ws = response.webSocket; ws.accept();
  return { ws, records, async finish() {
    try { ws.close(); } catch {}
    await deadline((async () => { while (connections.size) await pause(5); })(), 'Proxy socket was not closed');
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(records.errors, []);
  }, async cleanup() {
    try { ws.close(); } catch {}
    for (const socket of connections) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  } };
}

for (const [label, kind, options] of [
  ['HTTP CONNECT coalesced greeting', 'http', { banner: true }],
  ['HTTP CONNECT fragmented header and coalesced greeting', 'http', { split: true, banner: true }],
  ['SOCKS5 fragmented selection/connect with IPv4 bound address', 'socks5', { split: true, banner: true }],
  ['SOCKS5 fragmented authentication/domain reply', 'socks5', { split: true, auth: true, address: 'domain', banner: true }],
  ['SOCKS5 IPv6 reply and coalesced greeting', 'socks5', { address: 'ipv6', banner: true }],
  ['SOCKS5 complete reply without a buffered prefix', 'socks5', {}],
]) {
  test(`${label}: first and continuation bytes arrive exactly once`, { timeout: 10000 }, async () => {
    const f = await fixture(kind, options);
    const first = Buffer.from('first application request');
    const continued = Buffer.from('continued application request');
    const expected = Buffer.concat([Buffer.from([0, 0]), options.banner ? banner : Buffer.alloc(0), first]);
    try {
      assert.deepEqual(await receive(f.ws, expected.length, () => f.ws.send(frame(first))), expected);
      assert.deepEqual(await receive(f.ws, continued.length, () => f.ws.send(continued)), continued);
      assert.equal(f.records.premature, false, 'Application data must wait for the complete proxy handshake');
      assert.deepEqual(Buffer.concat(f.records.received), Buffer.concat([first, continued]));
      assert.equal(f.records.accepted, 1);
      assert.deepEqual(f.records.targets, [`${target}:443`]);
      await f.finish();
    } finally { await f.cleanup(); }
  });
}

for (const invalid of ['method-version', 'auth-version', 'reply-version', 'reserved', 'address-type', 'truncated']) {
  test(`SOCKS5 rejects ${invalid} and closes without sending application bytes`, { timeout: 10000 }, async () => {
    const f = await fixture('socks5', { invalid, auth: invalid === 'auth-version' });
    let received = 0;
    try {
      await deadline(new Promise(resolve => {
        f.ws.addEventListener('message', event => { received += event.data.byteLength; });
        f.ws.addEventListener('close', resolve, { once: true });
        f.ws.send(frame(Buffer.from('must not be written')));
      }), 'Invalid SOCKS reply did not close the tunnel');
      assert.equal(received, 0);
      assert.deepEqual(f.records.received, []);
      assert.equal(f.records.premature, false);
      await f.finish();
    } finally { await f.cleanup(); }
  });
}
