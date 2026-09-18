// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHunk } from '../src/grpc.js';

test('gRPC Hunk/MultiHunk preserve repeated data and skip unknown protobuf fields', () => {
  // data="a", unknown varint, data="bc", unknown fixed64/fixed32/bytes.
  const encoded = Uint8Array.from([10, 1, 97, 16, 150, 1, 10, 2, 98, 99, 25, ...Array(8).fill(0), 37, ...Array(4).fill(0), 42, 2, 100, 101]);
  assert.deepEqual(Buffer.from(decodeHunk(encoded)), Buffer.from('abc'));
  assert.deepEqual(decodeHunk(Uint8Array.from([10, 0])), new Uint8Array(0));
});

test('a single Hunk shares the payload view and preserves a nonzero input offset', () => {
  const backing = Uint8Array.from([255, 255, 10, 3, 97, 98, 99, 255]);
  const encoded = backing.subarray(2, 7);
  const payload = decodeHunk(encoded);
  assert.deepEqual([...payload], [97, 98, 99]);
  assert.equal(payload.buffer, backing.buffer);
  assert.equal(payload.byteOffset, encoded.byteOffset + 2);
  assert.equal(payload.byteLength, 3);
  backing[4] = 100;
  assert.equal(payload[0], 100);
});

test('unknown fields around a single Hunk are validated without copying the payload', () => {
  const encoded = Uint8Array.from([16, 150, 1, 10, 2, 97, 98, 42, 2, 99, 100, 37, 0, 0, 0, 0]);
  const payload = decodeHunk(encoded);
  assert.deepEqual([...payload], [97, 98]);
  assert.equal(payload.buffer, encoded.buffer);
  assert.equal(payload.byteOffset, encoded.byteOffset + 5);
});

test('MultiHunk still concatenates repeated data into an independent buffer', () => {
  const encoded = Uint8Array.from([10, 1, 97, 10, 0, 10, 2, 98, 99]);
  const payload = decodeHunk(encoded);
  assert.deepEqual([...payload], [97, 98, 99]);
  assert.notEqual(payload.buffer, encoded.buffer);
  encoded.fill(0);
  assert.deepEqual([...payload], [97, 98, 99]);
});

test('empty Hunk, repeated empty data and messages without data remain empty', () => {
  const encoded = Uint8Array.from([10, 0]);
  const payload = decodeHunk(encoded);
  assert.equal(payload.byteLength, 0);
  assert.equal(payload.buffer, encoded.buffer);
  for (const bytes of [[], [10, 0, 10, 0], [16, 1], [42, 1, 97]]) {
    assert.deepEqual(decodeHunk(Uint8Array.from(bytes)), new Uint8Array(0));
  }
});

test('a single valid Hunk never skips malformed trailing fields', async t => {
  const cases = [
    ['truncated data', [10, 2, 98], /Truncated protobuf field/],
    ['truncated unknown bytes', [18, 2, 98], /Truncated protobuf field/],
    ['unterminated unknown varint', [16, 128], /Truncated protobuf varint/],
    ['invalid field number', [2, 0], /Invalid protobuf field/],
    ['unsupported wire type', [19], /Unsupported protobuf wire type/],
    ['truncated unknown fixed64', [25, 0], /Truncated protobuf field/],
  ];
  for (const [label, suffix, error] of cases) {
    await t.test(label, () => assert.throws(() => decodeHunk(Uint8Array.from([10, 1, 97, ...suffix])), error));
  }
});

test('gRPC decoder rejects truncated field lengths and malformed varints', async t => {
  const cases = [
    ['length beyond message', [10, 3, 97, 98], /Truncated protobuf field/],
    ['unterminated length varint', [10, 128], /Truncated protobuf varint/],
    ['length varint too long', [10, ...Array(8).fill(128), 0], /varint too long/],
    ['length varint exceeds safe integer', [10, ...Array(7).fill(255), 127], /varint overflow/],
    ['zero field number', [2, 0], /Invalid protobuf field/],
    ['unsupported wire type', [11], /Unsupported protobuf wire type/],
    ['truncated fixed64', [17, 0], /Truncated protobuf field/],
    ['truncated fixed32', [21, 0], /Truncated protobuf field/],
  ];
  for (const [label, bytes, error] of cases) {
    await t.test(label, () => assert.throws(() => decodeHunk(Uint8Array.from(bytes)), error));
  }
});
