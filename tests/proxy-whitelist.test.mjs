// Copyright (C) 2026 Brclio. GPL-2.0-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROXY_WHITELIST, defaultProxyWhitelist, loadProxyWhitelist, matchesProxyWhitelist } from '../src/proxy-whitelist.js';

const savedConfig = entries => JSON.stringify({ 反代: { SOCKS5: { 白名单: entries } } });

test('absent KV and legacy config use built-in matches plus forced environment entries', async () => {
  const forced = 'forced.example, "*.forced.test"\nforced.example';
  const expected = [...DEFAULT_PROXY_WHITELIST, 'forced.example', '*.forced.test'];
  assert.deepEqual(await loadProxyWhitelist({ GO2SOCKS5: forced }), expected);
  for (const saved of [null, '{}', '{"反代":{"SOCKS5":{}}}', '{', savedConfig(null), savedConfig([123])]) {
    const reads = [];
    const entries = await loadProxyWhitelist({
      GO2SOCKS5: forced,
      KV: { async get(key) { reads.push(key); return saved; } },
    });
    assert.deepEqual(entries, expected);
    assert.deepEqual(reads, ['config.json'], 'Tunnel policy must not read credentials or notification settings');
  }
  assert.deepEqual(await loadProxyWhitelist({ KV: { async get() { throw new Error('temporarily unavailable'); } } }), DEFAULT_PROXY_WHITELIST);
});

test('saved entries replace defaults, explicit empty clears defaults, and forced env entries survive', async () => {
  let stored = savedConfig(['custom.example', ' *.custom.example ', 'custom.example']);
  const env = { GO2SOCKS5: 'forced.example', KV: { async get() { return stored; } } };
  const first = await loadProxyWhitelist(env);
  assert.deepEqual(first, ['custom.example', '*.custom.example', 'forced.example']);
  assert.equal(matchesProxyWhitelist('scholar.google.com', first), false, 'Saved policy replaces the built-in policy');
  stored = savedConfig([]);
  assert.deepEqual(await loadProxyWhitelist(env), ['forced.example']);
  assert.deepEqual(first, ['custom.example', '*.custom.example', 'forced.example'], 'Existing request keeps its snapshot');
  assert.deepEqual(await loadProxyWhitelist({ KV: env.KV }), []);
  assert.deepEqual(defaultProxyWhitelist(), DEFAULT_PROXY_WHITELIST, 'One request cannot pollute the next request defaults');
});

test('host whitelist treats only star as a wildcard and anchors the entire hostname', () => {
  const entries = ['*.example.com', 'exact.example', '[::1]', 'a+b?.(test){2}|x^$\\'];
  for (const host of ['WWW.EXAMPLE.COM', 'nested.sub.example.com', 'exact.example', '[::1]', 'a+b?.(test){2}|x^$\\']) {
    assert.equal(matchesProxyWhitelist(host, entries), true, `${host} must match literally or via star`);
  }
  for (const host of ['example.com', 'a.exampleXcom', 'exactXexample', 'exact.example.attacker.test', 'prefixexact.example', '::1', 'ab.testtest']) {
    assert.equal(matchesProxyWhitelist(host, entries), false, `${host} must not match`);
  }
  assert.equal(matchesProxyWhitelist('anything.example', []), false);
  assert.equal(matchesProxyWhitelist('anything.example', ['*']), true);
  assert.equal(matchesProxyWhitelist('cdn.tapecontent.net', DEFAULT_PROXY_WHITELIST), true);
  assert.equal(matchesProxyWhitelist('scholarXgoogle.com', DEFAULT_PROXY_WHITELIST), false);
});
