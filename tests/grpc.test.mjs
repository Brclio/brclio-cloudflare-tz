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
