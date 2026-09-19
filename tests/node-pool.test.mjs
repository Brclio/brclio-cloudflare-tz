// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RANDOM_NODE_COUNT, MAX_RANDOM_NODE_COUNT, normalizeRandomNodeCount, sampleUniqueIPv4 } from '../src/node-pool.js';

test('random count bounds preserve explicit choices and protect legacy values', () => {
  for (const count of [1, 16, 37, 64, 128, 1000]) assert.equal(normalizeRandomNodeCount(count), count);
  for (const count of [undefined, null, '', '128', NaN, Infinity, -1, 0, 1.5]) assert.equal(normalizeRandomNodeCount(count), DEFAULT_RANDOM_NODE_COUNT);
  assert.equal(normalizeRandomNodeCount(Number.MAX_SAFE_INTEGER), MAX_RANDOM_NODE_COUNT);
  assert.equal(sampleUniqueIPv4(['198.18.0.0/15'], Number.MAX_SAFE_INTEGER).length, MAX_RANDOM_NODE_COUNT);
});

test('overlap, duplicates, adjacent ranges and non-network bases form one unique pool', () => {
  const cidrs = ['192.0.2.3/30', '192.0.2.2/31', '192.0.2.3/32', '192.0.2.4/31', '192.0.2.4/31'];
  const expected = Array.from({ length: 6 }, (_, i) => `192.0.2.${i}`);
  for (const random of [() => 0, () => 0.5, () => 1 - Number.EPSILON]) {
    const samples = sampleUniqueIPv4(cidrs, 1000, random);
    assert.deepEqual(samples.sort(), expected);
  }
});

test('disjoint ranges retain gaps and invalid CIDRs never enter the sample', () => {
  const samples = sampleUniqueIPv4([' 192.0.2.1/32 ', '192.0.2.100/31', '255.255.255.255/32', '300.0.0.1/24', '192.0.2.0/33', '-1.0.0.0/8', '192.0.2.1', '::/0', '', null], 1000, () => 0);
  assert.deepEqual(samples.sort(), ['192.0.2.1', '192.0.2.100', '192.0.2.101', '255.255.255.255']);
  assert.deepEqual(sampleUniqueIPv4(['bad-row'], 1000), []);
});

test('the entire IPv4 range includes both unsigned endpoints without allocating the range', () => {
  assert.deepEqual(sampleUniqueIPv4(['0.0.0.0/0', '255.255.255.255/32'], 3, () => 0), ['0.0.0.0', '255.255.255.255', '255.255.255.254']);
  assert.deepEqual(sampleUniqueIPv4(['128.0.0.1/0'], 2, () => 1 - Number.EPSILON), ['255.255.255.255', '255.255.255.254']);
});

test('unique sampling finishes when the RNG always returns the same value', () => {
  let calls = 0;
  const samples = sampleUniqueIPv4(['198.18.0.0/15'], 1000, () => { calls++; return 0; });
  assert.equal(samples.length, 1000);
  assert.equal(new Set(samples).size, 1000);
  assert.equal(calls, 1000, 'No retries should be needed to avoid collisions');
});

test('every position in a small disjoint pool has equal first-draw weight', () => {
  const source = ['192.0.2.0/31', '198.51.100.0/30', '198.51.100.0/31'];
  const draws = Array.from({ length: 6 }, (_, i) => sampleUniqueIPv4(source, 1, () => (i + 0.5) / 6)[0]);
  assert.deepEqual(draws, ['192.0.2.0', '192.0.2.1', '198.51.100.0', '198.51.100.1', '198.51.100.2', '198.51.100.3']);
});
