// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prependSocketData } from '../src/proxy-streams.js';
import { withTimeout } from '../src/tunnel-runtime.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function socketFixture() {
  let reads = 0, closes = 0, source;
  const socket = {
    readable: new ReadableStream({
      start(controller) { source = controller; },
      pull(controller) { reads++; controller.enqueue(Uint8Array.of(reads)); },
    }, { highWaterMark: 0 }),
    writable: new WritableStream(), opened: Promise.resolve('opened'), closed: Promise.resolve('closed'),
    close() { closes++; source.close(); return Promise.resolve(); },
  };
  return { socket, get reads() { return reads; }, get closes() { return closes; } };
}

test('a prefixed socket preserves socket contracts without draining an unread source', async () => {
  const fixture = socketFixture();
  const wrapped = prependSocketData(fixture.socket, Uint8Array.of(9, 8));
  assert.equal(wrapped.writable, fixture.socket.writable);
  assert.equal(wrapped.opened, fixture.socket.opened);
  assert.equal(wrapped.closed, fixture.socket.closed);
  await tick();
  assert.equal(fixture.reads, 0, 'The buffered prefix fills the queue before any TCP read');
  const reader = wrapped.readable.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.of(9, 8));
  await tick();
  assert.equal(fixture.reads, 1, 'Only one next chunk may be prefetched for the stream high water mark');
  await tick();
  assert.equal(fixture.reads, 1, 'A paused consumer must not cause an eager read loop');
  assert.deepEqual((await reader.read()).value, Uint8Array.of(1));
  await reader.cancel();
  assert.equal(fixture.closes, 1);
  assert.equal(fixture.socket.readable.locked, false);
  await wrapped.close();
  assert.equal(fixture.closes, 1, 'Repeated closes are idempotent');
});

test('empty prefixes return the original socket and retain its native readable', () => {
  const fixture = socketFixture();
  assert.equal(prependSocketData(fixture.socket, new Uint8Array()), fixture.socket);
});

test('prefix wrapper forwards EOF and releases its source reader', async () => {
  const source = new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(2)); controller.close(); } });
  const socket = { readable: source, writable: new WritableStream(), opened: Promise.resolve(), closed: Promise.resolve(), close() {} };
  const reader = prependSocketData(socket, Uint8Array.of(1)).readable.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.of(1));
  assert.deepEqual((await reader.read()).value, Uint8Array.of(2));
  assert.equal((await reader.read()).done, true);
  assert.equal(source.locked, false);
});

test('prefix wrapper forwards source errors and releases its source reader', async () => {
  const failure = new Error('source failed');
  const source = new ReadableStream({ pull(controller) { controller.error(failure); } });
  const socket = { readable: source, writable: new WritableStream(), opened: Promise.resolve(), closed: Promise.resolve(), close() {} };
  const reader = prependSocketData(socket, Uint8Array.of(1)).readable.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.of(1));
  await assert.rejects(reader.read(), error => error === failure);
  assert.equal(source.locked, false);
});

const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const readChunkSource = workerSource.match(/^\s*async readChunk\(reader\) \{[^\n]+\}/m)?.[0];
assert.ok(readChunkSource, 'Exercise the actual TlsClient.readChunk method');
const readChunk = new Function('withTimeout', `return ({${readChunkSource}}).readChunk;`)(withTimeout);

for (const outcome of ['resolve', 'reject', 'timeout']) {
  test(`TLS readChunk ${outcome} releases its deadline`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const schedule = globalThis.setTimeout;
    let fired = 0;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => schedule(() => { fired++; callback(); }, delay));
    const clear = t.mock.method(globalThis, 'clearTimeout');
    const failure = new Error('TLS source failed');
    const value = { done: false, value: Uint8Array.of(1) };
    const reader = { read: () => outcome === 'resolve' ? Promise.resolve(value) : outcome === 'reject' ? Promise.reject(failure) : new Promise(() => {}) };
    const pending = readChunk.call({ timeout: 30000 }, reader);
    if (outcome === 'resolve') assert.equal(await pending, value);
    else if (outcome === 'reject') await assert.rejects(pending, error => error === failure);
    else {
      const rejected = assert.rejects(pending, { message: 'TLS read timeout' });
      t.mock.timers.tick(30000);
      await rejected;
    }
    assert.equal(clear.mock.callCount(), 1);
    t.mock.timers.tick(30000);
    assert.equal(fired, outcome === 'timeout' ? 1 : 0);
  });
}

test('TLS readChunk timeout=0 still disables deadlines', async t => {
  const schedule = t.mock.method(globalThis, 'setTimeout');
  const value = { done: true };
  assert.equal(await readChunk.call({ timeout: 0 }, { read: () => Promise.resolve(value) }), value);
  assert.equal(schedule.mock.callCount(), 0);
});
