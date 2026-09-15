// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Controlled outbound HTTP fixtures exercise the built Worker API without
// using production account credentials or third-party services.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://usage-panel.example.com';
const outgoing = [];
let customResponse = { success: true, pages: 12, workers: 34, total: 46, max: 100000 };
let responseDelay = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
  compatibilityDate: '2025-11-04',
  cf: false,
  kvNamespaces: ['KV'],
  bindings: { ADMIN: 'usage-contract-password', UUID: '00000000-0000-4000-8000-000000000001', OFF_LOG: 'true' },
  outboundService: async request => {
    outgoing.push({ url: request.url, authorization: request.headers.get('Authorization') });
    if (request.url === 'https://usage.example.com/counters') {
      if (responseDelay) await new Promise(resolve => setTimeout(resolve, responseDelay));
      return new Response(JSON.stringify(customResponse), { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.url === 'https://api.cloudflare.com/client/v4/graphql') {
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ pagesFunctionsInvocationsAdaptiveGroups: [{ sum: { requests: 5 } }], workersInvocationsAdaptive: [{ sum: { requests: 9 } }] }] } } }), { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected external request: ${request.url}`);
  },
}));
after(() => mf.dispose());

test('usage reads use stored credentials and tolerate malformed or slow upstream responses', { timeout: 20000 }, async t => {
  const login = await mf.dispatchFetch(`${origin}/login`, { method: 'POST', headers: { Origin: origin, 'User-Agent': 'Brclio-Usage-QA' }, body: 'password=usage-contract-password' });
  assert.equal(login.status, 200);
  const headers = { Origin: origin, 'User-Agent': 'Brclio-Usage-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  const request = (path, body) => mf.dispatchFetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });

  await t.test('Cloudflare query strings containing credentials are rejected without outbound requests', async () => {
    const count = outgoing.length;
    const response = await request('/admin/getCloudflareUsage?APIToken=must-not-be-used');
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /URL/);
    assert.equal(outgoing.length, count);
  });
  await t.test('refresh uses saved API token in the authorization header', async () => {
    assert.equal((await request('/admin/cf.json', { AccountID: 'test-account', APIToken: 'test-stored-token' })).status, 200);
    const response = await request('/admin/getCloudflareUsage');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, pages: 5, workers: 9, total: 14, max: 100000 });
    assert.equal(outgoing.at(-1).authorization, 'Bearer test-stored-token');
    assert.equal(outgoing.at(-1).url.includes('test-stored-token'), false);
  });
  await t.test('custom usage responses are validated and arbitrary fields are omitted', async () => {
    assert.equal((await request('/admin/cf.json', { UsageAPI: 'https://usage.example.com/counters' })).status, 200);
    customResponse = { success: true, pages: 12, workers: 34, total: 46, max: 100000, secret: 'not-a-counter' };
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), { success: true, pages: 12, workers: 34, total: 46, max: 100000 });
    for (const invalid of [null, [], { success: true, pages: 1 }, { success: true, pages: -1, workers: 2, total: 1, max: 100000 }, { success: true, pages: '1', workers: 2, total: 3, max: 100000 }]) {
      customResponse = invalid;
      const data = await (await request('/admin/getCloudflareUsage')).json();
      assert.deepEqual(data, { success: false, pages: 0, workers: 0, total: 0, max: 100000 });
    }
  });
  await t.test('null custom usage cannot break configuration reads or subscription generation', async () => {
    customResponse = null;
    const configResponse = await request('/admin/config.json');
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.CF.Usage.success, false);
    config.优选订阅生成.本地IP库.随机IP = false;
    assert.equal((await request('/admin/config.json', config)).status, 200);
    const kv = await mf.getKVNamespace('KV');
    await kv.put('ADD.txt', 'example.com:443#Local test');
    const subscription = await request(`/sub?token=${config.优选订阅生成.TOKEN}&b64`);
    assert.equal(subscription.status, 200);
    assert.match(Buffer.from(await subscription.text(), 'base64').toString('utf8'), /^vless:\/\//);
  });
  await t.test('a stalled usage endpoint returns unavailable within the four-second timeout', async () => {
    customResponse = { success: true, pages: 1, workers: 1, total: 2, max: 100000 };
    responseDelay = 8000;
    const started = performance.now();
    const response = await request('/admin/getCloudflareUsage');
    const elapsed = performance.now() - started;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, false);
    assert.ok(elapsed < 6500, `Expected timeout before slow fixture replied; elapsed ${elapsed.toFixed(0)} ms`);
    responseDelay = 0;
  });
});
