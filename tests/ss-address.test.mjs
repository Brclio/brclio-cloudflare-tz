// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShadowsocksAddressParser } from '../src/ss-address.js';

test('SS IPv4, IPv6 and maximum domains survive every address split without consuming payload', () => {
  const cases = [
    { header: Buffer.from([1, 127, 0, 0, 1, 1, 187]), hostname: '127.0.0.1' },
    { header: Buffer.from([4, ...Array(15).fill(0), 1, 1, 187]), hostname: '0:0:0:0:0:0:0:1' },
    { header: Buffer.concat([Buffer.from([3, 255]), Buffer.alloc(255, 97), Buffer.from([1, 187])]), hostname: 'a'.repeat(255) },
  ];
  const payload = Buffer.alloc(65536, 0x5a);
  for (const { header, hostname } of cases) {
    for (let split = 1; split < header.length; split++) {
      const parser = createShadowsocksAddressParser();
      assert.equal(parser.push(header.subarray(0, split)).status, 'need_more');
      const result = parser.push(Buffer.concat([header.subarray(split), payload]));
      assert.equal(result.status, 'ok');
      assert.equal(result.hostname, hostname);
      assert.equal(result.port, 443);
      assert.deepEqual(Buffer.from(result.rawData), payload);
      assert.equal(parser.push(Buffer.from([1])).status, 'invalid', 'A second address cannot reset the authenticated stream');
    }
  }
});

test('SS address parser rejects an empty domain and unsupported type before dialing', () => {
  assert.equal(createShadowsocksAddressParser().push(Buffer.from([3, 0])).status, 'invalid');
  for (const type of [0, 2, 5, 255]) {
    assert.equal(createShadowsocksAddressParser().push(Buffer.from([type])).status, 'invalid');
  }
});
