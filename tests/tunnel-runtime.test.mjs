// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialSettings, withTimeout, canReplayInitialData } from '../src/tunnel-runtime.js';

function assertSettings(actual, expected, message) {
  assert.deepEqual(actual, { connectTimeoutMs: 3000, proxyHandshakeTimeoutMs: 10000, ...expected }, message);
}

test('dial settings preserve carrier defaults without inheriting earlier requests', () => {
  assertSettings(dialSettings(), { tcpConcurrency: 2, proxyConcurrency: 1, preloadRace: false });
  assertSettings(dialSettings({}, 'cmcc'), { tcpConcurrency: 1, proxyConcurrency: 1, preloadRace: false });
  for (const carrier of ['ct', 'cu', 'cf', 'unknown']) {
    assertSettings(dialSettings({}, carrier), { tcpConcurrency: 2, proxyConcurrency: 1, preloadRace: false });
  }
});

test('explicit dial settings override carrier defaults and bound pending connections', () => {
  assertSettings(dialSettings({ TCP_CONCURRENT_DIAL: '4', PROXY_CONCURRENT_DIAL: '3', PRELOAD_RACE_DIAL: 'true' }, 'cmcc'),
    { tcpConcurrency: 4, proxyConcurrency: 3, preloadRace: true });
  assertSettings(dialSettings({ TCP_CONCURRENT_DIAL: '2.9', PROXY_CONCURRENT_DIAL: '0.5', PRELOAD_RACE_DIAL: '1' }),
    { tcpConcurrency: 2, proxyConcurrency: 1, preloadRace: true });
  assertSettings(dialSettings({ TCP_CONCURRENT_DIAL: '999999999', PROXY_CONCURRENT_DIAL: '1e100' }),
    { tcpConcurrency: 6, proxyConcurrency: 6, preloadRace: false });
  for (const value of [undefined, '', '0', 'false', 'TRUE', true]) {
    assert.equal(dialSettings({ PRELOAD_RACE_DIAL: value }).preloadRace, false, `Preload flag ${String(value)} must not opt in`);
  }
});

test('invalid concurrency inputs fall back without creating invalid candidate counts', () => {
  for (const value of [undefined, null, '', ' ', '0', '-1', 'not-a-number', 'Infinity', '-Infinity', '1e309', NaN, Infinity, -Infinity]) {
    const env = { TCP_CONCURRENT_DIAL: value, PROXY_CONCURRENT_DIAL: value };
    assertSettings(dialSettings(env), { tcpConcurrency: 2, proxyConcurrency: 1, preloadRace: false }, `Default carrier with ${String(value)}`);
    assertSettings(dialSettings(env, 'cmcc'), { tcpConcurrency: 1, proxyConcurrency: 1, preloadRace: false }, `Mobile carrier with ${String(value)}`);
  }
});

test('overlapping requests retain immutable independent snapshots when environments change', () => {
  const env = { TCP_CONCURRENT_DIAL: '5', PROXY_CONCURRENT_DIAL: '2', PRELOAD_RACE_DIAL: 'true' };
  const earlier = dialSettings(env, 'cmcc');
  delete env.TCP_CONCURRENT_DIAL;
  env.PROXY_CONCURRENT_DIAL = '4';
  env.PRELOAD_RACE_DIAL = 'false';
  const later = dialSettings(env, 'ct');
  assertSettings(earlier, { tcpConcurrency: 5, proxyConcurrency: 2, preloadRace: true });
  assertSettings(later, { tcpConcurrency: 2, proxyConcurrency: 4, preloadRace: false });
  assert.notEqual(earlier, later);
  assert.ok(Object.isFrozen(earlier));
  assert.throws(() => { earlier.tcpConcurrency = 6; }, TypeError);
  assertSettings(dialSettings({}, 'cmcc'), { tcpConcurrency: 1, proxyConcurrency: 1, preloadRace: false });
  assertSettings(dialSettings({}, 'ct'), { tcpConcurrency: 2, proxyConcurrency: 1, preloadRace: false });
});

function trackedTimers(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const schedule = globalThis.setTimeout;
  const handles = [];
  let fired = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    const handle = schedule(() => { fired++; callback(...args); }, delay);
    handles.push(handle);
    return handle;
  });
  const clear = t.mock.method(globalThis, 'clearTimeout');
  return { handles, clear, get fired() { return fired; } };
}

test('withTimeout returns a successful value and cancels its unused deadline', async t => {
  const timers = trackedTimers(t);
  const value = { socket: 'connected' };
  assert.equal(await withTimeout(Promise.resolve(value), 1000, 'connect deadline'), value);
  assert.equal(timers.handles.length, 1);
  assert.equal(timers.clear.mock.callCount(), 1);
  assert.equal(timers.clear.mock.calls[0].arguments[0], timers.handles[0]);
  t.mock.timers.tick(1000);
  assert.equal(timers.fired, 0, 'A completed connection must not leave a deadline callback queued');
});

test('withTimeout preserves a connection rejection and cancels its deadline', async t => {
  const timers = trackedTimers(t);
  const failure = new Error('connection refused');
  await assert.rejects(withTimeout(Promise.reject(failure), 1000, 'connect deadline'), error => error === failure);
  assert.equal(timers.clear.mock.callCount(), 1);
  assert.equal(timers.clear.mock.calls[0].arguments[0], timers.handles[0]);
  t.mock.timers.tick(1000);
  assert.equal(timers.fired, 0);
});

test('withTimeout rejects only at the deadline and cleans up the expired timer', async t => {
  const timers = trackedTimers(t);
  let settled = false;
  let finishConnection;
  const connection = new Promise(resolve => { finishConnection = resolve; });
  const pending = withTimeout(connection, 1000, 'connect deadline');
  pending.then(() => { settled = true; }, () => { settled = true; });
  const rejection = assert.rejects(pending, { message: 'connect deadline' });
  t.mock.timers.tick(999);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(timers.fired, 0);
  t.mock.timers.tick(1);
  await rejection;
  assert.equal(timers.fired, 1);
  assert.equal(timers.clear.mock.callCount(), 1);
  assert.equal(timers.clear.mock.calls[0].arguments[0], timers.handles[0]);
  finishConnection('late connection');
  await connection;
  t.mock.timers.tick(1000);
  assert.equal(timers.fired, 1);
});

test('finishing one connection does not cancel another connection deadline', async t => {
  const timers = trackedTimers(t);
  let finishEarlier;
  const earlier = withTimeout(new Promise(resolve => { finishEarlier = resolve; }), 1000, 'earlier deadline');
  const later = withTimeout(new Promise(() => {}), 1500, 'later deadline');
  const laterFailure = assert.rejects(later, { message: 'later deadline' });
  finishEarlier('ready');
  assert.equal(await earlier, 'ready');
  t.mock.timers.tick(1000);
  assert.equal(timers.fired, 0);
  t.mock.timers.tick(500);
  await laterFailure;
  assert.equal(timers.fired, 1);
  assert.equal(timers.clear.mock.callCount(), 2);
  assert.deepEqual(timers.clear.mock.calls.map(call => call.arguments[0]), timers.handles);
});


test('connection and proxy negotiation deadlines are bounded and request scoped', () => {
  assert.equal(dialSettings({ CONNECT_TIMEOUT_MS: '12000' }).connectTimeoutMs, 12000);
  assert.equal(dialSettings({ CONNECT_TIMEOUT_MS: '1' }).connectTimeoutMs, 250);
  assert.equal(dialSettings({ CONNECT_TIMEOUT_MS: '90000' }).connectTimeoutMs, 15000);
  assert.equal(dialSettings({ PROXY_HANDSHAKE_TIMEOUT_MS: '90000' }).proxyHandshakeTimeoutMs, 60000);
  assert.equal(dialSettings({ PROXY_HANDSHAKE_TIMEOUT_MS: '1' }).proxyHandshakeTimeoutMs, 1000);
  for (const value of ['0', '-1', 'Infinity', 'bad', undefined]) {
    assert.equal(dialSettings({ CONNECT_TIMEOUT_MS: value }).connectTimeoutMs, 3000);
    assert.equal(dialSettings({ PROXY_HANDSHAKE_TIMEOUT_MS: value }).proxyHandshakeTimeoutMs, 10000);
  }
});

test('initial fallback never replays POST, request bodies, TLS early data or arbitrary streams', () => {
  const bytes = text => new TextEncoder().encode(text);
  assert.equal(canReplayInitialData(null), true);
  assert.equal(canReplayInitialData(bytes('GET / HTTP/1.1\r\nHost: example.com\r\n\r\n')), true);
  assert.equal(canReplayInitialData(bytes('HEAD / HTTP/1.1\r\nContent-Length: 0\r\n\r\n')), true);
  for (const text of [
    'POST / HTTP/1.1\r\n\r\nbody',
    'GET / HTTP/1.1\r\nContent-Length: 1\r\n\r\nx',
    'GET / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n',
    'GET / HTTP/1.1\r\n', 'arbitrary binary stream',
  ]) assert.equal(canReplayInitialData(bytes(text)), false, text);
  assert.equal(canReplayInitialData(Uint8Array.of(22, 3, 3, 0, 1, 1)), true);
  assert.equal(canReplayInitialData(Uint8Array.of(22, 3, 3, 0, 1, 1, 23, 3, 3, 0, 1, 0)), false);
});
