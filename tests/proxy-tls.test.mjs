// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Deliberately public, test-only self-signed key/certificate: never production credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const uuid = '00000000-0000-4000-8000-000000000001';
const key = await readFile(new URL('./fixtures/untrusted-proxy-key.pem', import.meta.url));
const cert = await readFile(new URL('./fixtures/untrusted-proxy-cert.pem', import.meta.url));

test('native HTTPS-IP TLS rejects an untrusted certificate before proxy credentials or target data', { timeout: 12000 }, async () => {
  const connections = new Set();
  let accepted = 0, applicationBytes = 0;
  const server = tls.createServer({ key, cert }, socket => {
    socket.on('data', data => {
      applicationBytes += data.length;
      // A certificate-skipping implementation would reach CONNECT and receive
      // success, exposing credentials/application bytes to this untrusted peer.
      if (data.includes(Buffer.from('CONNECT '))) socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    });
  });
  server.on('connection', socket => {
    accepted++; connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    socket.on('error', () => {});
  });
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
    compatibilityDate: '2025-11-04', cf: { colo: 'TEST', asn: 0, country: 'XX' },
    bindings: { ADMIN: 'test-only-tls-password', UUID: uuid, OFF_LOG: 'true', TCP_CONCURRENT_DIAL: '1' },
    outboundService: () => new Response('External fetch blocked', { status: 599 }),
  }));
  let ws;
  try {
    await mf.ready;
    const query = new URLSearchParams({ https: `user:do-not-disclose@127.0.0.1:${server.address().port}`, globalproxy: '' });
    const response = await mf.dispatchFetch(`https://proxy-tls.example/tunnel?${query}`, { headers: { Upgrade: 'websocket' } });
    assert.equal(response.status, 101); ws = response.webSocket; ws.accept();
    const host = Buffer.from('target.test.invalid');
    const initial = Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'),
      Buffer.from([0, 1, 1, 187, 2, host.length]), host, Buffer.from('private application payload')]);
    let timer;
    try {
      await Promise.race([
        new Promise(resolve => { ws.addEventListener('close', resolve, { once: true }); ws.send(initial); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Untrusted HTTPS proxy did not close the tunnel')), 5000); }),
      ]);
    } finally { clearTimeout(timer); }
    assert.ok(accepted > 0, 'A real TCP/TLS peer must have been reached');
    // The server can emit secureConnection before the client reports its own
    // post-handshake trust decision. Only the absence of application bytes is
    // evidence that the client withheld CONNECT and its credentials.
    assert.equal(applicationBytes, 0, 'No CONNECT credentials or application bytes may reach an untrusted TLS peer');
  } finally {
    try { ws?.close(); } catch {}
    for (const socket of connections) socket.destroy();
    await mf.dispose();
    await new Promise(resolve => server.close(resolve));
  }
});
