// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTunnelHandshakeParser, isPossibleTunnelPrefix, MAX_TUNNEL_HEADER_BYTES, MAX_TROJAN_HEADER_BYTES } from '../src/tunnel-handshake.js';

const uuid = '00000000-0000-4000-8000-000000000001';
const uuidBytes = Buffer.from(uuid.replaceAll('-', ''), 'hex');
const hash = createHash('sha224').update(uuid).digest('hex');
const parser = () => createTunnelHandshakeParser(uuidBytes, hash);
const payload = Buffer.from('GET / HTTP/1.1\r\nHost: fixture.example.com\r\n\r\n');
function domain(name) { return Buffer.concat([Buffer.from([name.length]), Buffer.from(name)]); }
function vless(data = payload, options = Buffer.alloc(0), host = 'fixture.example.com') {
  return Buffer.concat([Buffer.from([0]), uuidBytes, Buffer.from([options.length]), options,
    Buffer.from([1, 1, 187, 2]), domain(host), data]);
}
function trojan(data = payload, host = 'fixture.example.com') {
  return Buffer.concat([Buffer.from(hash + '\r\n'), Buffer.from([1, 3]), domain(host), Buffer.from([1, 187, 13, 10]), data]);
}

test('authenticated VLESS remains VLESS when HTTP data contains CRLF at Trojan delimiter offsets', () => {
  const bytes = vless();
  assert.deepEqual(bytes.subarray(56, 58), Buffer.from('\r\n'));
  const result = parser().push(bytes);
  assert.equal(result.status, 'ok');
  assert.equal(result.protocol, 'vless');
  assert.equal(result.hostname, 'fixture.example.com');
  assert.equal(result.port, 443);
  assert.deepEqual(result.responseHeader, Uint8Array.of(0, 0));
  assert.deepEqual(Buffer.from(result.rawData), payload);
});

for (const [protocol, encode] of [['vless', vless], ['trojan', trojan]]) {
  test(`${protocol} retains every possible incomplete header split and returns application bytes exactly once`, () => {
    const header = encode(Buffer.alloc(0));
    for (let split = 1; split < header.length; split++) {
      const instance = parser();
      assert.equal(instance.push(header.subarray(0, split)).status, 'need_more', `split ${split}`);
      const result = instance.push(Buffer.concat([header.subarray(split), payload]));
      assert.equal(result.status, 'ok', `split ${split}`);
      assert.equal(result.protocol, protocol);
      assert.deepEqual(Buffer.from(result.rawData), payload);
      assert.equal(instance.push(payload).status, 'invalid', 'A completed parser cannot restart authentication');
    }
    const instance = parser();
    for (let index = 0; index < header.length - 1; index++) {
      assert.equal(instance.push(header.subarray(index, index + 1)).status, 'need_more');
    }
    assert.equal(instance.push(header.subarray(-1)).status, 'ok');
  });

  test(`${protocol} authenticates before returning a destination and rejects malformed headers`, () => {
    const credentialStart = protocol === 'vless' ? 1 : 0;
    const credentialLength = protocol === 'vless' ? 16 : 56;
    for (let index = credentialStart; index < credentialStart + credentialLength; index++) {
      const packet = encode();
      packet[index] ^= 1;
      assert.equal(parser().push(packet).status, 'invalid', `credential byte ${index}`);
    }
    const commandOffset = protocol === 'vless' ? 18 : 58;
    const addressTypeOffset = protocol === 'vless' ? 21 : 59;
    for (const [offset, value] of [[commandOffset, 255], [addressTypeOffset, 255], [addressTypeOffset + 1, 0]]) {
      const packet = encode();
      packet[offset] = value;
      assert.equal(parser().push(packet).status, 'invalid', `malformed field ${offset}`);
    }
    if (protocol === 'trojan') {
      for (const offset of [56, 57, encode(Buffer.alloc(0)).length - 2, encode(Buffer.alloc(0)).length - 1]) {
        const packet = encode();
        packet[offset] = 0;
        assert.equal(parser().push(packet).status, 'invalid', `delimiter ${offset}`);
      }
    }
  });
}

test('maximum VLESS and Trojan headers remain bounded while allowing large first payloads', () => {
  const largePayload = Buffer.alloc(128 * 1024, 73);
  const maxVless = vless(Buffer.alloc(0), Buffer.alloc(255), 'a'.repeat(255));
  const maxTrojan = trojan(Buffer.alloc(0), 'a'.repeat(255));
  assert.equal(maxVless.length, MAX_TUNNEL_HEADER_BYTES);
  assert.equal(maxTrojan.length, MAX_TROJAN_HEADER_BYTES);
  for (const header of [maxVless, maxTrojan]) {
    const instance = parser();
    assert.equal(instance.push(header.subarray(0, -1)).status, 'need_more');
    const result = instance.push(Buffer.concat([header.subarray(-1), largePayload]));
    assert.equal(result.status, 'ok');
    assert.deepEqual(Buffer.from(result.rawData), largePayload);
  }
  assert.equal(parser().push(Buffer.alloc(2 * MAX_TUNNEL_HEADER_BYTES, 255)).status, 'invalid');
});

test('early-data recognition accepts partial credential prefixes and ignores ordinary WS subprotocol bytes', () => {
  for (const packet of [vless(), trojan()]) {
    for (const split of [1, 8, 18, 24]) assert.equal(isPossibleTunnelPrefix(packet.subarray(0, split), uuidBytes, hash), true);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from('binary', 'base64url'), Buffer.from([255]), Buffer.from([0, 255])]) {
    assert.equal(isPossibleTunnelPrefix(bytes, uuidBytes, hash), false);
  }
});
