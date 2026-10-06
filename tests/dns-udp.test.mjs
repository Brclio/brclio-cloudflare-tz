// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDNSFrameParser, createTrojanUDPParser, encodeDNSFrame, encodeTrojanUDPResponse, exchangeDNSFrame,
} from '../src/dns-udp.js';

const query = Uint8Array.of(0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0);
const answer = Uint8Array.of(0x12, 0x34, 0x81, 0x80, 0, 0, 0, 0, 0, 0, 0, 0);
const concat = (...values) => new Uint8Array(Buffer.concat(values.map(value => Buffer.from(value))));
const frame = encodeDNSFrame(query);
function trojan(payload = query, host = 'dns.example.com') {
  const addressPort = concat(Uint8Array.of(3, host.length), new TextEncoder().encode(host), Uint8Array.of(0, 53));
  return concat(addressPort, Uint8Array.of(payload.length >>> 8, payload.length & 255, 13, 10), payload);
}

test('DNS framing retains all possible prefix/payload splits and consecutive queries', () => {
  for (let split = 1; split < frame.length; split++) {
    const parser = createDNSFrameParser();
    assert.deepEqual(parser.push(frame.subarray(0, split)), []);
    assert.deepEqual(parser.push(concat(frame.subarray(split), frame)), [frame, frame]);
    parser.finish();
    assert.equal(parser.bufferedBytes, 0);
  }
  const parser = createDNSFrameParser();
  const output = [];
  for (const byte of concat(frame, frame)) output.push(...parser.push(Uint8Array.of(byte)));
  assert.deepEqual(output, [frame, frame]);
});

test('DNS framing bounds incomplete state to one 65535-byte datagram and rejects truncated EOF', () => {
  const parser = createDNSFrameParser();
  const large = encodeDNSFrame(new Uint8Array(65535));
  for (const byte of large.subarray(0, -1)) parser.push(Uint8Array.of(byte));
  assert.equal(parser.bufferedBytes, 65536);
  assert.throws(() => parser.finish(), /Truncated/);
  assert.deepEqual(parser.push(large.subarray(-1)), [large]);
  parser.finish();
  parser.push(Uint8Array.of(0));
  assert.throws(() => parser.finish(), /Truncated/);
  parser.clear(); parser.finish();
  assert.throws(() => createDNSFrameParser().push(Uint8Array.of(0, 0)), /length/);
  assert.throws(() => encodeDNSFrame(new Uint8Array(65536)), /length/);
});

test('Trojan framing retains split address/header/payload and emits multiple DNS datagrams', () => {
  const wire = trojan();
  for (let split = 1; split < wire.length; split++) {
    const parser = createTrojanUDPParser();
    assert.deepEqual(parser.push(wire.subarray(0, split)), []);
    const packets = parser.push(concat(wire.subarray(split), wire));
    assert.equal(packets.length, 2);
    assert.deepEqual(packets[0].payload, query);
    assert.deepEqual(encodeTrojanUDPResponse(packets[0].addressPort, encodeDNSFrame(answer)), trojan(answer));
    parser.finish();
  }
  const parser = createTrojanUDPParser();
  parser.push(wire.subarray(0, -1));
  assert.throws(() => parser.finish(), /Truncated/);
  parser.clear(); parser.finish();
});

test('Trojan DNS rejects unsupported UDP ports, malformed domains and delimiters before dialing', () => {
  const wrongPort = trojan(); wrongPort[wrongPort.length - query.length - 5] = 80;
  assert.throws(() => createTrojanUDPParser().push(wrongPort), /UDP is not supported/);
  const delimiter = trojan(); delimiter[delimiter.length - query.length - 1] = 0;
  assert.throws(() => createTrojanUDPParser().push(delimiter), /delimiter/);
  assert.throws(() => createTrojanUDPParser().push(Uint8Array.of(2)), /address type/);
  assert.throws(() => createTrojanUDPParser().push(Uint8Array.of(3, 0)), /domain length/);
});

function resolver({ chunks = [encodeDNSFrame(answer)], eof = false, writeError, open, writePending = false } = {}) {
  const record = { writes: [], closed: 0, cancelled: 0, aborted: 0 };
  let upstream;
  const readable = new ReadableStream({
    start(controller) { upstream = controller; for (const chunk of chunks) controller.enqueue(chunk); if (eof) controller.close(); },
    cancel() { record.cancelled++; },
  });
  const writable = new WritableStream({
    write(value) { record.writes.push(value); if (writeError) throw writeError; if (writePending) return new Promise(() => {}); },
    abort() { record.aborted++; },
  });
  record.socket = { opened: open, readable, writable, close() { record.closed++; } };
  record.connect = options => { assert.deepEqual(options, { hostname: '8.8.4.4', port: 53 }); return record.socket; };
  return record;
}

test('DNS exchange returns at complete frame while upstream stays open, preserving prefix and payload bytes', async () => {
  const response = encodeDNSFrame(answer);
  for (let split = 1; split < response.length; split++) {
    const record = resolver({ chunks: [response.subarray(0, split), response.subarray(split)] });
    assert.deepEqual(await exchangeDNSFrame(frame, record.connect, { timeoutMs: 100 }), response);
    assert.deepEqual(record.writes, [frame]);
    assert.equal(record.closed, 1);
    assert.equal(record.socket.readable.locked, false);
    assert.equal(record.socket.writable.locked, false);
  }
});

test('DNS consecutive exchanges complete without requiring resolver EOF', async () => {
  const records = [];
  const connect = options => { const record = resolver(); records.push(record); return record.connect(options); };
  for (let index = 0; index < 3; index++) assert.deepEqual(await exchangeDNSFrame(frame, connect), encodeDNSFrame(answer));
  assert.equal(records.length, 3);
  assert.ok(records.every(record => record.closed === 1));
});

test('DNS premature resolver EOF rejects a truncated length prefix or payload and closes sockets', async () => {
  for (const chunks of [[], [Uint8Array.of(0)], [Uint8Array.of(0, 12, 1)]]) {
    const record = resolver({ chunks, eof: true });
    await assert.rejects(exchangeDNSFrame(frame, record.connect), /Truncated|without a response/);
    assert.equal(record.closed, 1);
    assert.equal(record.socket.readable.locked, false);
    assert.equal(record.socket.writable.locked, false);
  }
});

test('DNS write failure propagates and closes the socket', async () => {
  const record = resolver({ writeError: new Error('fixture write failure') });
  await assert.rejects(exchangeDNSFrame(frame, record.connect), /fixture write failure/);
  assert.equal(record.closed, 1);
  assert.equal(record.socket.writable.locked, false);
});

test('DNS deadline cancels a stalled read and releases locks', async () => {
  const record = resolver({ chunks: [] });
  await assert.rejects(exchangeDNSFrame(frame, record.connect, { timeoutMs: 10 }), /timed out/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(record.closed >= 1);
  assert.equal(record.cancelled, 1);
  assert.equal(record.socket.readable.locked, false);
  assert.equal(record.socket.writable.locked, false);
});

test('DNS cancellation closes an active resolver and does not start pre-aborted queries', async () => {
  const record = resolver({ chunks: [] });
  const controller = new AbortController();
  const pending = exchangeDNSFrame(frame, record.connect, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort(new Error('fixture client cancelled'));
  await assert.rejects(pending, /fixture client cancelled/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(record.cancelled, 1);
  assert.equal(record.socket.readable.locked, false);
  let dialed = false;
  await assert.rejects(exchangeDNSFrame(frame, () => { dialed = true; }, { signal: controller.signal }), /fixture client cancelled/);
  assert.equal(dialed, false);
});

test('DNS deadline also covers socket.opened and closes pending dials', async () => {
  let finishOpening;
  const record = resolver({ open: new Promise(resolve => { finishOpening = resolve; }) });
  await assert.rejects(exchangeDNSFrame(frame, record.connect, { timeoutMs: 10 }), /timed out/);
  assert.ok(record.closed >= 1);
  assert.equal(record.writes.length, 0);
  finishOpening();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(record.writes.length, 0, 'A dial that opens after its deadline must never write a stale DNS query');
});
