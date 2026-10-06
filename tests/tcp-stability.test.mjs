// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Exercise the production dial coordinator with observable socket lifetimes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dialSettings, withTimeout, canReplayInitialData } from '../src/tunnel-runtime.js';
import { createProxyHandshakeDeadline } from '../src/proxy-deadline.js';

const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
function declaration(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
const forwarding = declaration('async function forwardataTCP(', '\nasync function forwardataudp(');
const generations = declaration('function 失效TCP连接世代(', '\nasync function 读取叉HTTP首包(');
const connectorSource = declaration('function 创建请求TCP连接器(', '\n////////////////////////////////////////////TLSClient');
const grainSource = declaration('function 创建Grain收纳器(', '\nfunction 创建上行Grain合包流(');
const queueSource = declaration('function 创建上行写入队列(', '\nfunction 创建下行Grain发送器(');
const trojanSource = declaration('async function 连接木马反代(', '\nfunction 提取木马反代握手数据(');
const createQueue = new Function(`
  const 上行合包目标字节 = 20480, 上行队列最大字节 = 16777216, 上行队列最大条目 = 4096;
  const 数据转Uint8Array = data => data;
  const log = () => {};
  ${grainSource}
  ${queueSource}
  return 创建上行写入队列;
`)();
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function socket() {
  const opening = deferred();
  let closes = 0;
  return {
    opening, opened: opening.promise, closed: new Promise(() => {}),
    readable: new ReadableStream(), writable: new WritableStream(),
    close() { closes++; opening.reject(new Error('Socket closed')); return Promise.resolve(); },
    get closes() { return closes; },
  };
}
function fixture(connector, settings = dialSettings(), lookup = async () => []) {
  const create = new Function('dialSettings', 'withTimeout', 'connect', 'canReplayInitialData', 'DoH查询', `
    const WebSocket = { OPEN: 1 };
    const log = () => {};
    const 有效数据长度 = data => data?.byteLength || 0;
    const 数据转Uint8Array = data => data;
    const matchesProxyWhitelist = () => false;
    const DEFAULT_PROXY_WHITELIST = [];
    const 特征码字典 = ['PROXYIP', 'fixture', '000'];
    const closeSocketQuietly = socket => socket.close();
    const isIPHostname = value => /^[0-9.]+$/.test(value);
    const isIPv4 = isIPHostname;
    ${connectorSource}
    const 解析地址端口 = async () => [['fallback.example', 443]];
    ${generations}
    ${forwarding}
    return { forwardataTCP, 失效TCP连接世代 };
  `)(dialSettings, withTimeout, connector, canReplayInitialData, lookup);
  const owner = { socket: null, generation: 0, downlinkDrain: Promise.resolve() };
  const client = { readyState: 1, close() { this.readyState = 3; } };
  return {
    owner, client,
    start: () => create.forwardataTCP('target.example', 443, null, client, null, owner, 'uuid', null,
      { 拨号配置: settings }, false, null, true),
    cancel: () => create.失效TCP连接世代(owner),
  };
}

test('a healthy TCP connection taking 1200ms is not prematurely replaced', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = socket(), fallback = socket();
  const dials = [];
  const run = fixture(options => { dials.push(options); return dials.length === 1 ? first : fallback; }, dialSettings({ TCP_CONCURRENT_DIAL: '1' }));
  const pending = run.start();
  pending.catch(() => {});
  await flush();
  t.mock.timers.tick(1200);
  await flush();
  assert.equal(dials.length, 1, 'A healthy slow connection must keep its original destination');
  assert.equal(first.closes, 0);
  first.opening.resolve({});
  assert.equal(await pending, first);
});

test('winning a dial race immediately closes still-pending losers', async () => {
  const winner = socket(), loser = socket();
  let calls = 0;
  const run = fixture(() => ++calls === 1 ? winner : loser);
  const pending = run.start();
  await flush();
  winner.opening.resolve({});
  assert.equal(await pending, winner);
  assert.ok(loser.closes > 0, 'Pending losers must release their connection slot before opened settles');
  assert.equal(winner.closes, 0);
});

test('cancelling while dialing releases pending sockets without a fallback dial', async () => {
  const pendingSocket = socket();
  let calls = 0;
  const run = fixture(() => { calls++; return pendingSocket; }, dialSettings({ TCP_CONCURRENT_DIAL: '1' }));
  const pending = run.start();
  pending.catch(() => {});
  await flush();
  run.client.readyState = 3;
  run.cancel();
  await flush();
  assert.ok(pendingSocket.closes > 0, 'Client cancellation must close a socket that is not opened yet');
  await assert.rejects(pending);
  assert.equal(calls, 1, 'Cancelled connections must not start a proxy fallback');
});

test('a late DNS lookup cannot dial or send after the client cancels', async () => {
  const lookup = deferred();
  let dials = 0;
  const run = fixture(() => { dials++; const value = socket(); value.opening.resolve({}); return value; },
    dialSettings({ PRELOAD_RACE_DIAL: 'true' }), () => lookup.promise);
  const pending = run.start();
  pending.catch(() => {});
  await flush();
  assert.equal(dials, 0);
  run.client.readyState = 3;
  run.cancel();
  lookup.resolve([{ type: 1, data: '127.0.0.1' }]);
  await assert.rejects(pending);
  assert.equal(dials, 0, 'Late DNS results must not create new sockets for a closed tunnel');
});

test('a partially failed application write is never replayed on another TCP connection', async () => {
  const accepted = [];
  let retries = 0, closes = 0;
  const failure = new Error('Connection lost after accepting a prefix');
  const writer = { async write(bytes) { accepted.push(bytes.slice(0, 3)); throw failure; } };
  const replacement = { async write(bytes) { accepted.push(bytes); } };
  let current = writer;
  const queue = createQueue({
    获取写入器: () => current, 释放写入器() {},
    重试连接: async () => { retries++; current = replacement; },
    关闭连接: () => { closes++; },
  });
  await assert.rejects(queue.写入并等待(new TextEncoder().encode('POST /messages HTTP/1.1\r\n\r\nbody')), error => error === failure);
  await queue.等待空();
  assert.equal(retries, 0, 'A write failure cannot prove that the remote accepted zero bytes');
  assert.equal(accepted.length, 1, 'Application bytes must never be duplicated into a fresh connection');
  assert.equal(closes, 1);
});

test('cancelling an upload releases drain waiters even while the native write is pending', async () => {
  const write = deferred();
  const queue = createQueue({ 获取写入器: () => ({ write: () => write.promise }), 关闭连接() {} });
  const upload = queue.写入并等待(Uint8Array.of(1, 2));
  upload.catch(() => {});
  await flush();
  let drained = false;
  const drain = queue.等待空().then(() => { drained = true; });
  queue.清空();
  await flush();
  assert.equal(drained, true, 'Cancelled lifecycle cleanup cannot wait forever for a native write');
  await assert.rejects(upload, /queue closed/);
  write.reject(new Error('socket closed'));
  await drain;
});

for (const stage of ['opened', 'write']) {
  test(`a stalled Trojan relay ${stage} is closed at the total negotiation deadline`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const value = socket();
    if (stage === 'write') {
      value.opening.resolve({});
      value.writable = new WritableStream({ write: () => new Promise(() => {}) });
    }
    const connectRelay = new Function('createProxyHandshakeDeadline', `
      const stripIPv6Brackets = value => value;
      const 有效数据长度 = value => value?.byteLength || 0;
      const 数据转Uint8Array = value => value;
      ${trojanSource}
      return 连接木马反代;
    `)(createProxyHandshakeDeadline);
    const pending = connectRelay(Uint8Array.of(1), () => value, { hostname: 'relay.example', port: 443 }, 40);
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await flush();
    t.mock.timers.tick(40);
    await flush();
    assert.equal(settled, true, 'A relay must not wait indefinitely during setup');
    await assert.rejects(pending, /handshake timed out/);
    assert.ok(value.closes > 0);
  });
}
