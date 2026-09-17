// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Controlled outbound HTTP fixtures exercise the built Worker API without
// using production account credentials or third-party services.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://usage-panel.example.com';
const outgoing = [];
const unavailable = { success: false, pages: 0, workers: 0, total: 0, max: 100000 };
const graphqlResult = (pages, workers) => ({ data: { viewer: { accounts: [{ pagesFunctionsInvocationsAdaptiveGroups: pages, workersInvocationsAdaptive: workers }] } }, errors: null });
let graphqlResponse = graphqlResult([{ sum: { requests: 5 } }], [{ sum: { requests: 9 } }]);
let graphqlStatus = 200;
let accountsResponse = { success: true, result: [{ id: 'fallback-account', name: 'Other account' }, { id: 'email-account', name: 'usage@example.com account' }] };
let customResponse = { success: true, pages: 12, workers: 34, total: 46, max: 100000 };
let customStatus = 200;
let responseDelay = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
  compatibilityDate: '2025-11-04',
  cf: false,
  kvNamespaces: ['KV'],
  bindings: { ADMIN: 'usage-contract-password', UUID: '00000000-0000-4000-8000-000000000001', OFF_LOG: 'true' },
  outboundService: async request => {
    outgoing.push({ url: request.url, authorization: request.headers.get('Authorization'), email: request.headers.get('X-Auth-Email'), key: request.headers.get('X-Auth-Key'), cookie: request.headers.get('Cookie'), body: request.method === 'POST' ? await request.json() : null });
    if (new URL(request.url).origin === 'https://usage.example.com' && new URL(request.url).pathname === '/counters') {
      if (responseDelay) await new Promise(resolve => setTimeout(resolve, responseDelay));
      return new Response(JSON.stringify(customResponse), { status: customStatus, headers: { 'Content-Type': 'application/json' } });
    }
    if (request.url === 'https://api.cloudflare.com/client/v4/accounts') {
      return new Response(JSON.stringify(accountsResponse), { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.url === 'https://api.cloudflare.com/client/v4/graphql') {
      return new Response(JSON.stringify(graphqlResponse), { status: graphqlStatus, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected external request: ${request.url}`);
  },
}));
after(() => mf.dispose());

test('usage reads and validation preserve credentials and distinguish real zero from unavailable analytics', { timeout: 30000 }, async t => {
  const login = await mf.dispatchFetch(`${origin}/login`, { method: 'POST', headers: { Origin: origin, 'User-Agent': 'Brclio-Usage-QA' }, body: 'password=usage-contract-password' });
  assert.equal(login.status, 200);
  const headers = { Origin: origin, 'User-Agent': 'Brclio-Usage-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  const request = (path, body) => mf.dispatchFetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const kv = await mf.getKVNamespace('KV');

  await t.test('unauthenticated usage reads and missing credentials never contact Cloudflare', async () => {
    const count = outgoing.length;
    assert.equal((await mf.dispatchFetch(`${origin}/admin/getCloudflareUsage`)).status, 401);
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
    assert.equal(outgoing.length, count);
  });
  await t.test('Cloudflare query strings containing credentials are rejected without outbound requests', async () => {
    const count = outgoing.length;
    for (const field of ['APIToken', 'email', 'GlobalAPIKey', 'accountid', 'UsageAPI']) {
      const response = await request(`/admin/getCloudflareUsage?${field}=must-not-be-used`);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /URL/);
    }
    assert.equal(outgoing.length, count);
  });
  await t.test('refresh uses saved API token, both datasets and one consistent UTC day window', async () => {
    assert.equal((await request('/admin/cf.json', { AccountID: 'test-account', APIToken: 'test-stored-token' })).status, 200);
    const before = Date.now();
    const response = await request('/admin/getCloudflareUsage');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { success: true, pages: 5, workers: 9, total: 14, max: 100000 });
    assert.equal(outgoing.at(-1).authorization, 'Bearer test-stored-token');
    assert.equal(outgoing.at(-1).url.includes('test-stored-token'), false);
    const { query, variables } = outgoing.at(-1).body;
    assert.match(query, /\$AccountID: string/);
    assert.equal((query.match(/filter: \{datetime_geq: \$datetimeStart, datetime_leq: \$datetimeEnd\}/g) || []).length, 2);
    assert.equal(variables.AccountID, 'test-account');
    assert.match(variables.datetimeStart, /T00:00:00\.000Z$/);
    assert.equal(variables.datetimeStart.slice(0, 10), variables.datetimeEnd.slice(0, 10));
    assert.ok(Date.parse(variables.datetimeEnd) >= before && Date.parse(variables.datetimeEnd) <= Date.now());
    assert.equal(outgoing.at(-1).cookie, null);
  });
  await t.test('empty datasets are successful zero and multiple rows are summed without capping at the quota', async () => {
    graphqlResponse = graphqlResult([], []);
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), { ...unavailable, success: true });
    graphqlResponse = graphqlResult([{ sum: { requests: 0 } }, { sum: { requests: 60000 } }], [{ sum: { requests: 40000 } }, { sum: { requests: 25 } }]);
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), { success: true, pages: 60000, workers: 40025, total: 100025, max: 100000 });
  });
  await t.test('partial GraphQL datasets, bad counts and partial error responses remain unavailable', async () => {
    const invalidRows = [undefined, null, {}, [null], [{}], [{ sum: {} }], [{ sum: { requests: null } }], [{ sum: { requests: '9' } }], [{ sum: { requests: -1 } }], [{ sum: { requests: 0.5 } }], [{ sum: { requests: Number.MAX_SAFE_INTEGER } }, { sum: { requests: 1 } }]];
    for (const rows of invalidRows) {
      graphqlResponse = graphqlResult(rows, []);
      assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
      graphqlResponse = graphqlResult([], rows);
      assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
    }
    for (const invalid of [null, {}, { data: { viewer: { accounts: [] } } }, { ...graphqlResult([], []), errors: [{ message: 'private-token-from-upstream' }] }, { ...graphqlResult([], []), errors: {} }]) {
      graphqlResponse = invalid;
      assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
    }
    graphqlResponse = graphqlResult([], []);
    graphqlStatus = 403;
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
    graphqlStatus = 200;
    graphqlResponse = graphqlResult([{ sum: { requests: 5 } }], [{ sum: { requests: 9 } }]);
  });
  await t.test('Email and Global API Key resolve an account and use only key headers', async () => {
    assert.equal((await request('/admin/cf.json', { Email: 'usage@example.com', GlobalAPIKey: 'global-key-fixture' })).status, 200);
    const count = outgoing.length;
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), { success: true, pages: 5, workers: 9, total: 14, max: 100000 });
    assert.deepEqual(outgoing.slice(count).map(item => item.url), ['https://api.cloudflare.com/client/v4/accounts', 'https://api.cloudflare.com/client/v4/graphql']);
    for (const item of outgoing.slice(count)) {
      assert.equal(item.email, 'usage@example.com');
      assert.equal(item.key, 'global-key-fixture');
      assert.equal(item.authorization, null);
      assert.equal(item.cookie, null);
    }
    assert.equal(outgoing.at(-1).body.variables.AccountID, 'email-account');
    for (const invalid of [null, { result: [] }, { result: [{}] }, { success: false, result: [{ id: 'do-not-use' }] }]) {
      accountsResponse = invalid;
      const countBeforeFailure = outgoing.length;
      assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
      assert.equal(outgoing.length, countBeforeFailure + 1);
    }
    accountsResponse = { success: true, result: [{ id: 'email-account', name: 'usage@example.com account' }] };
  });
  await t.test('unsaved validation supports all three modes without changing saved credentials', async () => {
    const saved = await kv.get('cf.json');
    for (const input of [
      { mode: 'token', AccountID: 'unsaved-account', APIToken: 'unsaved-token' },
      { mode: 'key', Email: 'usage@example.com', GlobalAPIKey: 'unsaved-key' },
      { mode: 'api', UsageAPI: 'https://usage.example.com/counters' },
    ]) {
      const response = await request('/admin/getCloudflareUsage', input);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
      assert.equal(await kv.get('cf.json'), saved);
    }
    graphqlStatus = 403;
    assert.deepEqual(await (await request('/admin/getCloudflareUsage', { mode: 'token', AccountID: 'unsaved-account', APIToken: 'bad-token' })).json(), unavailable);
    assert.equal(await kv.get('cf.json'), saved);
    graphqlStatus = 200;
  });
  await t.test('validation reuses only same-mode blank fields and rejects malformed or cross-origin input', async () => {
    assert.equal((await request('/admin/cf.json', { AccountID: 'stored-validation-account', APIToken: 'stored-validation-token' })).status, 200);
    const saved = await kv.get('cf.json');
    assert.equal((await (await request('/admin/getCloudflareUsage', { mode: 'token', AccountID: '', APIToken: 'replacement-token', UsageAPI: 'https://ignored.example.com' })).json()).success, true);
    assert.equal(outgoing.at(-1).body.variables.AccountID, 'stored-validation-account');
    assert.equal(outgoing.at(-1).authorization, 'Bearer replacement-token');
    const count = outgoing.length;
    for (const input of [null, [], {}, { mode: 'api' }, { mode: 'key', Email: 'missing-key@example.com' }, { mode: 'token', APIToken: 'abc***de' }, { mode: 'token', APIToken: 123 }, { mode: 'token', APIToken: 'x'.repeat(4097) }]) {
      const response = await request('/admin/getCloudflareUsage', input);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), unavailable);
    }
    const badJSON = await mf.dispatchFetch(`${origin}/admin/getCloudflareUsage`, { method: 'POST', headers, body: '{"APIToken":"private-invalid-json' });
    assert.equal(badJSON.status, 400);
    assert.deepEqual(await badJSON.json(), unavailable);
    const crossOrigin = await mf.dispatchFetch(`${origin}/admin/getCloudflareUsage`, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example.com' }, body: JSON.stringify({ mode: 'token' }) });
    assert.equal(crossOrigin.status, 403);
    assert.equal(outgoing.length, count);
    assert.equal(await kv.get('cf.json'), saved);
  });
  await t.test('custom usage responses are validated and arbitrary fields are omitted', async () => {
    assert.equal((await request('/admin/cf.json', { UsageAPI: 'https://usage.example.com/counters' })).status, 200);
    customResponse = { success: true, pages: 12, workers: 34, total: 46, max: 100000, secret: 'not-a-counter' };
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), { success: true, pages: 12, workers: 34, total: 46, max: 100000 });
    assert.equal(outgoing.at(-1).authorization, null);
    assert.equal(outgoing.at(-1).key, null);
    assert.equal(outgoing.at(-1).cookie, null);
    for (const invalid of [null, [], { success: true, pages: 1 }, { success: true, pages: -1, workers: 2, total: 1, max: 100000 }, { success: true, pages: '1', workers: 2, total: 3, max: 100000 }, { success: true, pages: 12, workers: 34, total: 99, max: 100000 }, { success: true, pages: 0, workers: 0, total: 0, max: 0 }]) {
      customResponse = invalid;
      const data = await (await request('/admin/getCloudflareUsage')).json();
      assert.deepEqual(data, { success: false, pages: 0, workers: 0, total: 0, max: 100000 });
    }
    customResponse = { success: true, pages: 0, workers: 0, total: 0, max: 250000 };
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), customResponse);
    customStatus = 500;
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
    customStatus = 200;
  });
  await t.test('malformed stored credentials fail without exposing secret text', async () => {
    const saved = await kv.get('cf.json');
    const count = outgoing.length;
    await kv.put('cf.json', '{"APIToken":"private-secret-in-invalid-json');
    assert.deepEqual(await (await request('/admin/getCloudflareUsage')).json(), unavailable);
    assert.equal(outgoing.length, count);
    await kv.put('cf.json', saved);
  });
  await t.test('custom API configuration exposes only a fixed saved marker even when analytics fails', async () => {
    const secretURL = 'https://usage.example.com/counters?token=private-custom-api-token';
    assert.equal((await request('/admin/cf.json', { UsageAPI: secretURL })).status, 200);
    for (const upstreamStatus of [200, 403]) {
      customStatus = upstreamStatus;
      customResponse = { success: true, pages: 0, workers: 0, total: 0, max: 100000 };
      const response = await request('/admin/config.json');
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.equal(body.includes(secretURL), false);
      assert.equal(body.includes('private-custom-api-token'), false);
      const config = JSON.parse(body);
      assert.equal(config.CF.UsageAPI, '********');
      assert.equal(config.CF.Usage.success, upstreamStatus === 200);
      assert.equal(JSON.parse(await kv.get('cf.json')).UsageAPI, secretURL);
    }
    customStatus = 200;
    assert.equal((await (await request('/admin/getCloudflareUsage', { mode: 'api', UsageAPI: '' })).json()).success, true);
    assert.equal(outgoing.at(-1).url, secretURL);
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
