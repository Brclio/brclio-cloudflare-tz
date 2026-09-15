// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Exercise the real built Worker's router, not handleAdminTool in isolation.
// Every application outbound fetch is fenced locally: routing regressions can
// never send a real Telegram notification or probe a production endpoint.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://tools-routing.example.com';
const password = 'local-routing-regression-admin-only';
const userAgent = 'Brclio-Tool-Routing-QA';
const outgoing = [];
const invalidTools = [
  { path: '/admin/testSubAPI', input: { url: 'https://user:password@converter.invalid' }, error: /订阅转换地址/ },
  { path: '/admin/testTelegram', input: {}, error: /sendMessage: true/ },
  { path: '/admin/ipDetail', input: { ip: '1.2.3.999' }, error: /IPv4 或 IPv6/ },
];
let mf;
let cookie;

before(async () => {
  const script = await readFile(new URL('../dist/_worker.js', import.meta.url), 'utf8');
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-09-01',
    cf: { colo: 'TEST', asn: 0, country: 'XX', city: 'Local test' },
    kvNamespaces: ['KV'],
    bindings: { ADMIN: password, UUID: '00000000-0000-4000-8000-000000000001', OFF_LOG: 'true', PROXYIP: '127.0.0.1:1' },
    outboundService: request => {
      outgoing.push({ url: request.url, method: request.method });
      return new Response('Outbound requests are blocked in the routing regression', { status: 599 });
    },
  }));
  await mf.ready;
  const response = await mf.dispatchFetch(origin + '/login', {
    method: 'POST',
    headers: { 'User-Agent': userAgent, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString(),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  cookie = response.headers.get('Set-Cookie').split(';')[0];
});
after(async () => { if (mf) await mf.dispose(); });

function request(path, { input, rawBody, method = 'POST', authenticated = true, requestOrigin = origin, headers = {} } = {}) {
  return mf.dispatchFetch(origin + path, {
    method,
    redirect: 'manual',
    headers: { 'User-Agent': userAgent, 'Content-Type': 'application/json', Origin: requestOrigin, ...(authenticated ? { Cookie: cookie } : {}), ...headers },
    ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(input ?? {}) } : {}),
  });
}

async function expectJSONError(response, status, error) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('Content-Type') || '', /^application\/json\b/, 'Tool routes must not silently fall back to management HTML');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  if (error) assert.match(body.error, error);
  assert.deepEqual(outgoing, [], 'Input validation and auth failures must happen before any outbound fetch');
  return body;
}

test('exact camelCase admin tool paths reach their JSON validators in the built Worker', async t => {
  for (const tool of invalidTools) {
    await t.test(tool.path, async () => {
      const body = await expectJSONError(await request(tool.path, { input: tool.input }), 400, tool.error);
      assert.equal(body.success, false);
    });
  }
});

test('Telegram test route requires an explicit flag and saved credentials before any send', async t => {
  for (const input of [{}, { sendMessage: false }, { sendMessage: 'true' }]) {
    await t.test(`non-explicit flag: ${JSON.stringify(input)}`, async () => {
      await expectJSONError(await request('/admin/testTelegram', { input }), 400, /sendMessage: true/);
    });
  }
  await t.test('explicit request with absent saved credentials is rejected locally', async () => {
    assert.equal(await (await mf.getKVNamespace('KV')).get('tg.json'), null);
    await expectJSONError(await request('/admin/testTelegram', { input: { sendMessage: true } }), 400, /Telegram Bot Token 和 Chat ID/);
  });
});

test('anonymous camelCase tool requests are rejected before JSON validation', async t => {
  for (const tool of invalidTools) {
    await t.test(tool.path, async () => {
      await expectJSONError(await request(tool.path, { input: tool.input, authenticated: false }), 401, /登录/);
    });
  }
});

test('authenticated cross-origin camelCase tool requests are rejected before execution', async t => {
  for (const tool of invalidTools) {
    await t.test(tool.path, async () => {
      await expectJSONError(await request(tool.path, { input: tool.input, requestOrigin: 'https://untrusted.invalid' }), 403, /来源/);
    });
  }
});

test('cross-site fetch metadata blocks tool writes even with a matching Origin', async () => {
  await expectJSONError(await request('/admin/testTelegram', {
    input: { sendMessage: true }, headers: { 'Sec-Fetch-Site': 'cross-site' },
  }), 403, /来源/);
});

test('camelCase tools respond with JSON 405 for GET instead of returning HTML', async t => {
  for (const tool of invalidTools) {
    await t.test(tool.path, async () => {
      await expectJSONError(await request(tool.path, { method: 'GET' }), 405, /仅支持 POST/);
    });
  }
});

test('malformed request JSON is rejected by each camelCase tool route', async t => {
  for (const tool of invalidTools) {
    await t.test(tool.path, async () => {
      await expectJSONError(await request(tool.path, { rawBody: '{' }), 400, /有效 JSON/);
    });
  }
});

test('catalogue and ProxyIP validation also stay inside JSON tool routing without a probe', async () => {
  await expectJSONError(await request('/admin/catalog?kind=not-a-catalogue', { method: 'GET' }), 400, /目录类型无效/);
  await expectJSONError(await request('/admin/check', { input: { type: 'proxyip', address: 'user:secret@proxy.invalid' } }), 400, /ProxyIP 地址无效/);
});
