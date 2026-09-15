// Copyright (C) 2026 Brclio. GPL-2.0-only.
// These are real HTTP fixtures on loopback. They never contact Telegram,
// public proxy checkers, or a user's configured converter.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const outgoing = [];
let fixture = () => ({ body: { success: true } });
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const entry = { url: request.headers['x-fixture-target'], method: request.method, body, headers: request.headers };
  outgoing.push(entry);
  const result = await fixture(entry);
  if (response.destroyed) return;
  response.writeHead(result.status || 200, { 'Content-Type': 'application/json', ...result.headers });
  response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureURL = `http://127.0.0.1:${server.address().port}/fixture`;
after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });

test('administrator tools use explicit requests and controlled outbound HTTP', { timeout: 20000 }, async t => {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => realFetch(fixtureURL, {
    ...options, headers: { ...options.headers, 'X-Fixture-Target': String(url) },
  }));
  const { handleAdminTool } = await import('../src/admin-tools.js');
  const saved = new Map();
  const env = { KV: { get: async key => saved.get(key) ?? null } };
  const request = (path, body, method = body === undefined ? 'GET' : 'POST') => handleAdminTool(new Request(`https://admin.example.com${path}`, {
    method, headers: { Cookie: 'session=must-not-forward', Authorization: 'must-not-forward', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, path.split('?')[0]);

  await t.test('import, unknown paths, invalid input, and non-proxyip checks do not start requests', async () => {
    assert.equal(outgoing.length, 0);
    assert.equal(await request('/admin/unrelated'), null);
    assert.equal(await request('/admin/check?socks5=host:1080'), null);
    const original = new Request('https://admin.example.com/admin/check', { method: 'POST', body: JSON.stringify({ type: 'socks5', address: 'host:1080' }) });
    assert.equal(await handleAdminTool(original, env, 'admin/check'), null);
    assert.deepEqual(await original.json(), { type: 'socks5', address: 'host:1080' });
    assert.equal((await request('/admin/catalog?kind=constructor')).status, 400);
    assert.equal((await request('/admin/catalog?kind=subapi&url=https://bad.example')).status, 400);
    assert.equal((await request('/admin/catalog?kind=subapi', {}, 'POST')).status, 405);
    assert.equal((await request('/admin/testSubAPI', { url: 'https://user:password@converter.example' })).status, 400);
    assert.equal((await request('/admin/testSubAPI', { url: 'x'.repeat(9000) })).status, 400);
    assert.equal((await request('/admin/testTelegram', {})).status, 400);
    assert.equal((await request('/admin/check', { type: 'proxyip', address: 'secret@host:443' })).status, 400);
    assert.equal(outgoing.length, 0);
  });

  await t.test('catalogue requests use only their fixed sources and retain upstream data shapes', async () => {
    const cases = {
      subapi: ['https://raw.githubusercontent.com/cmliu/cmliu/main/SUBAPI.json', [{ label: 'Fixture', value: 'converter.example' }]],
      subconfig: ['https://raw.githubusercontent.com/cmliu/cmliu/main/SUBCONFIG.json', { Fixture: [] }],
      paths: ['https://raw.githubusercontent.com/cmliu/cmliu/main/json/edt-path-config.json', { socks5: '/socks5={value}' }],
      socks5: ['https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/socks5.json', { data: [] }],
      http: ['https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/http.json', { data: [] }],
      https: ['https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/https.json', { data: [] }],
      proxyip: ['https://zip.cm.edu.kg.cmliussss.net/all.json', { generated_at: 'fixture', data: [{ ip: '192.0.2.1', port: [443], meta: { country: 'US' } }] }],
    };
    for (const [kind, [source, data]] of Object.entries(cases)) {
      fixture = entry => { assert.equal(entry.url, source); return { body: data }; };
      const response = await request(`/admin/catalog?kind=${kind}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, kind, source, data });
      assert.equal(outgoing.at(-1).headers.cookie, undefined);
      assert.equal(outgoing.at(-1).headers.authorization, undefined);
    }
  });

  await t.test('version parsing returns the version without exposing fetched source', async () => {
    fixture = () => ({ body: 'const Version = "2026-09-04 16:24:13";\nconst secret = "not-a-version";' });
    const response = await request('/admin/catalog?kind=version');
    assert.deepEqual((await response.json()).data, { version: '2026-09-04 16:24:13' });
  });

  await t.test('converter validation performs one GET /version and checks the actual response', async () => {
    fixture = entry => {
      assert.equal(entry.url, 'https://converter.example/version');
      assert.equal(entry.method, 'GET');
      return { body: 'subconverter v0.9.0' };
    };
    const response = await request('/admin/testSubAPI', { url: 'converter.example/sub?target=clash' });
    assert.deepEqual(await response.json(), { success: true, url: 'https://converter.example', version: 'subconverter v0.9.0' });
    fixture = () => ({ body: '<html>not a converter</html>' });
    assert.equal((await request('/admin/testSubAPI', { url: 'converter.example' })).status, 502);
  });

  await t.test('Telegram uses saved credentials and explicitly sends exactly one fixture message', async () => {
    const token = '123456789:FAKE_FIXTURE_TOKEN';
    saved.set('tg.json', JSON.stringify({ BotToken: token, ChatID: '-1001234567' }));
    const start = outgoing.length;
    fixture = entry => {
      assert.equal(entry.method, 'POST');
      if (entry.url.endsWith('/getMe')) return { body: { ok: true, result: { is_bot: true, username: 'brclio_fixture_bot' } } };
      assert.equal(entry.url, `https://api.telegram.org/bot${token}/sendMessage`);
      assert.equal(JSON.parse(entry.body).chat_id, '-1001234567');
      assert.match(JSON.parse(entry.body).text, /Brclio Edge/);
      return { body: { ok: true, result: { message_id: 123, chat: { id: -1001234567 } } } };
    };
    const response = await request('/admin/testTelegram', { sendMessage: true, BotToken: 'must-be-ignored', ChatID: 'must-be-ignored' });
    assert.equal(response.status, 200);
    const result = await response.text();
    assert.equal(JSON.parse(result).sent, true);
    assert.equal(JSON.parse(result).username, 'brclio_fixture_bot');
    assert.equal(result.includes(token), false);
    assert.equal(result.includes('-1001234567'), false);
    assert.equal(outgoing.length - start, 2);
  });

  await t.test('Telegram failures do not send messages or echo remote descriptions containing credentials', async () => {
    const start = outgoing.length;
    fixture = () => ({ body: { ok: false, description: 'FAKE_FIXTURE_TOKEN and private chat id' } });
    const response = await request('/admin/testTelegram', { sendMessage: true });
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes('FAKE_FIXTURE_TOKEN'), false);
    assert.equal(outgoing.length - start, 1);
  });

  await t.test('ProxyIP checks encode the address and expose only supported result fields', async () => {
    fixture = entry => {
      assert.equal(new URL(entry.url).origin, 'https://api.090227.xyz');
      assert.equal(new URL(entry.url).searchParams.get('proxyip'), '[2001:db8::1]:443');
      return { body: { success: true, responseTime: 124, supports_ipv4: true, supports_ipv6: true, ip: '192.0.2.1', loc: 'US', secret: 'not-a-result-field' } };
    };
    const response = await request('/admin/check', { type: 'proxyip', address: '[2001:db8::1]:443' });
    assert.deepEqual(await response.json(), { success: true, supports_ipv4: true, supports_ipv6: true, ip: '192.0.2.1', loc: 'US', responseTime: 124 });
  });

  await t.test('HTTP errors, malformed data, and oversized response bodies fail clearly', async () => {
    fixture = () => ({ status: 503, body: 'maintenance' });
    assert.equal((await request('/admin/catalog?kind=subapi')).status, 502);
    fixture = () => ({ body: 'not-json' });
    assert.equal((await request('/admin/catalog?kind=subapi')).status, 502);
    fixture = () => ({ body: 'x'.repeat(9000) });
    assert.equal((await request('/admin/testSubAPI', { url: 'converter.example' })).status, 502);
  });

  await t.test('IP detail validates literal IPs and queries only the named information source', async () => {
    const count = outgoing.length;
    for (const ip of ['example.com', '1.2.3.999', 'https://example.com', '::zz', '127.000.0.1']) {
      assert.equal((await request('/admin/ipDetail', { ip })).status, 400);
    }
    assert.equal(outgoing.length, count);
    for (const ip of ['192.0.2.1', '2001:db8::1']) {
      const data = { ip, location: { country_code: 'US', latitude: 37.5 }, asn: { asn: 64500 }, is_proxy: false };
      fixture = entry => {
        assert.equal(new URL(entry.url).origin, 'https://api.ipapi.is');
        assert.equal(new URL(entry.url).searchParams.get('q'), ip);
        return { body: data };
      };
      assert.deepEqual(await (await request('/admin/ipDetail', { ip })).json(), { success: true, source: 'https://api.ipapi.is/', data });
    }
  });

  await t.test('a stalled remote endpoint stops at the six-second deadline', async () => {
    fixture = () => new Promise(resolve => {
      const timer = setTimeout(() => resolve({ body: 'subconverter late response' }), 12000);
      timer.unref();
    });
    const started = performance.now();
    const response = await request('/admin/testSubAPI', { url: 'converter.example' });
    assert.equal(response.status, 504);
    assert.ok(performance.now() - started < 7500);
    assert.match((await response.json()).error, /超时/);
  });
});
