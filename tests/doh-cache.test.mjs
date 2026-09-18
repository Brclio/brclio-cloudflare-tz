// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Execute the production resolver with DNS wire replies and a controlled clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const start = source.indexOf('const DoH缓存 =');
const end = source.indexOf('async function 读取config_JSON(', start);
assert.ok(start >= 0 && end > start);
const makeResolver = new Function('fetch', 'Date', 'log', source.slice(start, end) + '\nreturn DoH查询;');

function record(type, ttl, data) {
  const header = Buffer.alloc(11); // root name, TYPE, CLASS, TTL, RDLENGTH
  header.writeUInt16BE(type, 1);
  header.writeUInt16BE(1, 3);
  header.writeUInt32BE(ttl, 5);
  header.writeUInt16BE(data.length, 9);
  return Buffer.concat([header, data]);
}
function reply(last, { ttl = 1, cnameTTL, negative, soaTTL, minimum = 30, rcode = 0 } = {}) {
  const answers = [], authority = [];
  if (!negative) answers.push(record(1, ttl, Buffer.from([192, 0, 2, last])));
  if (cnameTTL !== undefined) answers.unshift(record(5, cnameTTL, Buffer.from([1, 97, 0])));
  if (soaTTL !== undefined) {
    const data = Buffer.alloc(22); // two root names, serial/refresh/retry/expire/minimum
    data.writeUInt32BE(minimum, 18);
    authority.push(record(6, soaTTL, data));
  }
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8180 | rcode, 2);
  header.writeUInt16BE(answers.length, 6);
  header.writeUInt16BE(authority.length, 8);
  return new Response(Buffer.concat([header, ...answers, ...authority]));
}
function fixture(options) {
  let now = 0, calls = 0;
  const resolver = makeResolver(async () => reply(++calls, options), { now: () => now }, () => {});
  return { resolver, advance(ms) { now += ms; }, get calls() { return calls; } };
}

test('short DNS TTL expires instead of keeping an obsolete ProxyIP for five minutes', async () => {
  const f = fixture({ ttl: 1 });
  assert.equal((await f.resolver('short.example', 'A'))[0].data, '192.0.2.1');
  f.advance(500);
  assert.equal((await f.resolver('SHORT.example.', 'a'))[0].data, '192.0.2.1');
  f.advance(500);
  assert.equal((await f.resolver('short.example', 'A'))[0].data, '192.0.2.2');
  assert.equal(f.calls, 2);
});

test('TTL zero records are never reused', async () => {
  const f = fixture({ ttl: 0 });
  await f.resolver('zero.example', 'A');
  await f.resolver('zero.example', 'A');
  assert.equal(f.calls, 2);
});

test('a shorter CNAME TTL bounds cached address lifetime', async () => {
  const f = fixture({ ttl: 3600, cnameTTL: 1 });
  await f.resolver('alias.example', 'A');
  f.advance(1000);
  const answers = await f.resolver('alias.example', 'A');
  assert.equal(answers.find(a => a.type === 1).data, '192.0.2.2');
});

test('long authoritative TTL remains useful and DNS services have separate caches', async () => {
  const f = fixture({ ttl: 3600 });
  await f.resolver('cache.example', 'A', 'https://one.example/dns-query');
  f.advance(301000);
  assert.equal((await f.resolver('cache.example', 'A', 'https://one.example/dns-query'))[0].data, '192.0.2.1');
  assert.equal((await f.resolver('cache.example', 'A', 'https://two.example/dns-query'))[0].data, '192.0.2.2');
  assert.equal(f.calls, 2);
});

for (const rcode of [0, 3]) {
  test(`negative DNS answer rcode=${rcode} expires at the smaller SOA TTL/MINIMUM`, async () => {
    const f = fixture({ negative: true, soaTTL: 20, minimum: 30, rcode });
    assert.deepEqual(await f.resolver('missing.example', 'A'), []);
    f.advance(19000);
    assert.deepEqual(await f.resolver('missing.example', 'A'), []);
    assert.equal(f.calls, 1);
    f.advance(1000);
    await f.resolver('missing.example', 'A');
    assert.equal(f.calls, 2);
  });
}

test('negative DNS answer also respects a smaller SOA MINIMUM', async () => {
  const f = fixture({ negative: true, soaTTL: 60, minimum: 1 });
  await f.resolver('missing.example', 'A');
  f.advance(1000);
  await f.resolver('missing.example', 'A');
  assert.equal(f.calls, 2);
});

test('negative result through an alias expires when its CNAME changes', async () => {
  const f = fixture({ negative: true, cnameTTL: 1, soaTTL: 300, minimum: 300 });
  await f.resolver('alias.example', 'A');
  f.advance(1000);
  await f.resolver('alias.example', 'A');
  assert.equal(f.calls, 2);
});

for (const [name, options] of [
  ['no SOA', { negative: true }],
  ['zero SOA TTL', { negative: true, soaTTL: 0 }],
  ['SERVFAIL', { negative: true, soaTTL: 30, rcode: 2 }],
]) {
  test(`negative DNS response with ${name} is not cached`, async () => {
    const f = fixture(options);
    await f.resolver('missing.example', 'A');
    await f.resolver('missing.example', 'A');
    assert.equal(f.calls, 2);
  });
}

test('negative cache is capped to five minutes even with a long SOA', async () => {
  const f = fixture({ negative: true, soaTTL: 3600, minimum: 3600 });
  await f.resolver('missing.example', 'A');
  f.advance(300000);
  await f.resolver('missing.example', 'A');
  assert.equal(f.calls, 2);
});
