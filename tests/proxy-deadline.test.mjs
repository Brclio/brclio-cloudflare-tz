// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProxyHandshakeDeadline } from '../src/proxy-deadline.js';
import { prependSocketData } from '../src/proxy-streams.js';

// Execute the production negotiation functions with controlled socket streams.
// Real workerd/TCP fixtures remain in proxy-handshake and proxy-tls tests.
const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const negotiation = source.slice(source.indexOf('async function socks5Connect('), source.indexOf('\nfunction 创建请求TCP连接器('));
const ipHelpers = source.slice(source.indexOf('function stripIPv6Brackets('), source.indexOf('const CONNECT_TIMEOUT_MS'));
const { socks5Connect, httpConnect, httpsConnect } = new Function(
  'createProxyHandshakeDeadline', 'prependSocketData', '有效数据长度', '数据转Uint8Array', '拼接字节数据',
  `${negotiation}\n${ipHelpers}\nreturn { socks5Connect, httpConnect, httpsConnect };`,
)(createProxyHandshakeDeadline, prependSocketData, value => value?.byteLength || 0, value => value,
  (a, b) => { const result = new Uint8Array(a.length + b.length); result.set(a); result.set(b, a.length); return result; });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const proxy = { hostname: 'proxy.example', port: 443, username: 'user', password: 'secret' };
const payload = new TextEncoder().encode('application bytes');
const encode = value => new TextEncoder().encode(value);

function fixture({ opened = Promise.resolve(), onWrite = () => {} } = {}) {
  let controller, closes = 0, resolveClosed;
  const writes = [];
  const socket = {
    opened, closed: new Promise(resolve => { resolveClosed = resolve; }),
    readable: new ReadableStream({ start(value) { controller = value; } }, { highWaterMark: 0 }),
    writable: new WritableStream({ async write(value) { writes.push(value.slice()); await onWrite(value, writes.length); } }),
    close() { closes++; try { controller.close(); } catch {} resolveClosed(); return Promise.resolve(); },
  };
  return { socket, writes, feed(value) { try { controller.enqueue(value); } catch {} }, get closes() { return closes; } };
}

for (const kind of ['SOCKS5', 'HTTP', 'HTTPS']) {
  test(`${kind} silent negotiation expires and releases socket locks`, { timeout: 1000 }, async () => {
    const f = fixture();
    const operation = kind === 'SOCKS5' ? socks5Connect('target.example', 443, payload, () => f.socket, proxy, 40)
      : httpConnect('target.example', 443, payload, kind === 'HTTPS', () => f.socket, proxy, 40);
    await assert.rejects(operation, /handshake timed out/);
    assert.equal(f.closes, 1);
    assert.equal(f.socket.readable.locked, false);
    assert.equal(f.socket.writable.locked, false);
    assert.equal(f.writes.length, 1, 'Application bytes must not precede CONNECT success');
  });
}

for (const kind of ['SOCKS5', 'HTTP']) {
  test(`${kind} continuously fragmented reply shares one finite deadline`, { timeout: 1000 }, async () => {
    const f = fixture();
    const operation = kind === 'SOCKS5' ? socks5Connect('target.example', 443, payload, () => f.socket, proxy, 65)
      : httpConnect('target.example', 443, payload, false, () => f.socket, proxy, 65);
    const rejected = assert.rejects(operation, /handshake timed out/);
    const bytes = kind === 'SOCKS5' ? Uint8Array.of(5, 0, 5, 0, 0, 1, 127, 0, 0, 1, 0, 80)
      : encode('HTTP/1.1 200 Connection Established\r\n\r\n');
    for (const byte of bytes.subarray(0, 4)) { await pause(20); f.feed(Uint8Array.of(byte)); }
    await rejected;
    assert.equal(f.closes, 1);
    assert.equal(f.writes.some(value => Buffer.from(value).equals(Buffer.from(payload))), false);
  });
}

test('opening a proxy socket and a blocked negotiation write also consume the total deadline', { timeout: 1000 }, async () => {
  for (const stage of ['open', 'write']) {
    const f = fixture({ opened: stage === 'open' ? new Promise(() => {}) : Promise.resolve(),
      onWrite: () => stage === 'write' ? new Promise(() => {}) : undefined });
    await assert.rejects(socks5Connect('target.example', 443, payload, () => f.socket, proxy, 30), /handshake timed out/);
    assert.equal(f.closes, 1);
    assert.equal(f.socket.readable.locked, false);
    assert.equal(f.socket.writable.locked, false);
  }
});

test('a stalled first application write does not escape the negotiation deadline', { timeout: 1000 }, async () => {
  const f = fixture({ onWrite: (_, count) => count === 2 ? new Promise(() => {}) : undefined });
  f.feed(encode('HTTP/1.1 200 Connection Established\r\n\r\n'));
  await assert.rejects(httpConnect('target.example', 443, payload, false, () => f.socket, proxy, 35), /handshake timed out/);
  assert.equal(f.closes, 1);
  assert.equal(f.writes.length, 2);
  assert.equal(f.socket.writable.locked, false);
});

test('HTTPS IP proxies use verified native TLS and send no credentials when opening fails', async () => {
  const failure = new Error('certificate verify failed');
  const f = fixture({ opened: Promise.reject(failure) });
  const calls = [];
  await assert.rejects(httpsConnect('target.example', 443, payload, (...args) => { calls.push(args); return f.socket; },
    { ...proxy, hostname: '192.0.2.4' }), error => /证书.*域名/.test(error.message) && error.cause === failure);
  assert.deepEqual(calls, [[{ hostname: '192.0.2.4', port: 443 }, { secureTransport: 'on', allowHalfOpen: false }]]);
  assert.equal(f.writes.length, 0);
  assert.equal(f.closes, 1);
});

test('successful HTTPS CONNECT retains bytes, native stream backpressure and no idle deadline', { timeout: 1000 }, async () => {
  const f = fixture();
  f.feed(encode('HTTP/1.1 200 Connection Established\r\n\r\ngreeting'));
  const socket = await httpsConnect('target.example', 443, payload, () => f.socket, proxy, 40);
  assert.equal(socket.writable, f.socket.writable);
  assert.equal(f.writes.length, 2);
  assert.match(new TextDecoder().decode(f.writes[0]), /Proxy-Authorization: Basic dXNlcjpzZWNyZXQ=/);
  assert.deepEqual(f.writes[1], payload);
  const reader = socket.readable.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'greeting');
  await pause(70);
  assert.equal(f.closes, 0, 'The completed handshake must not cut off an idle tunnel');
  f.feed(encode('later'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'later');
  await reader.cancel();
  assert.equal(f.closes, 1);
});

test('an HTTPS proxy stays open beyond the former 30-second custom-TLS idle cutoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.feed(encode('HTTP/1.1 200 Connection Established\r\n\r\n'));
  const socket = await httpsConnect('target.example', 443, payload, () => f.socket, proxy);
  assert.equal(socket, f.socket, 'An empty prefix returns the native TLS socket, bypassing TlsClient.readChunk');
  const reader = socket.readable.getReader();
  const read = reader.read();
  t.mock.timers.tick(31000);
  assert.equal(f.closes, 0, 'The completed handshake and long-lived read have no idle timer');
  f.feed(encode('download continuation'));
  assert.equal(new TextDecoder().decode((await read).value), 'download continuation');
  reader.releaseLock();
  socket.close();
});

test('HTTP CONNECT rejects oversized headers even when the terminator is in the same chunk', async () => {
  const f = fixture();
  f.feed(encode(`HTTP/1.1 200 OK\r\nX-Padding: ${'x'.repeat(8200)}\r\n\r\n`));
  await assert.rejects(httpConnect('target.example', 443, payload, false, () => f.socket, proxy), /响应头过长/);
  assert.equal(f.closes, 1);
  assert.equal(f.writes.length, 1);
});

test('HTTP CONNECT formats IPv6 target authorities with one pair of brackets', async () => {
  for (const target of ['2001:db8::4', '[2001:db8::4]']) {
    const f = fixture();
    f.feed(encode('HTTP/1.1 200 OK\r\n\r\n'));
    await httpConnect(target, 443, new Uint8Array(), false, () => f.socket, proxy);
    assert.match(new TextDecoder().decode(f.writes[0]), /^CONNECT \[2001:db8::4\]:443 HTTP\/1\.1\r\n/);
    f.socket.close();
  }
});

test('the shared deadline clears its only timer after success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const deadline = createProxyHandshakeDeadline(f.socket, 100);
  await deadline.wait(() => Promise.resolve());
  t.mock.timers.tick(70);
  await deadline.wait(() => Promise.resolve());
  deadline.dispose();
  t.mock.timers.tick(100);
  assert.equal(f.closes, 0);
});
