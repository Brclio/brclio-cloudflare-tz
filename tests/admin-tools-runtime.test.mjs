// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Run the deployed bundle in workerd. All outbound requests terminate in local
// fixtures, including Telegram sends; no real account or network is contacted.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://tools-runtime.example.com';
const outgoing = [];
let fixture = () => { throw new Error('Unexpected outbound request'); };
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
  compatibilityDate: '2025-11-04',
  cf: false,
  kvNamespaces: ['KV'],
  bindings: { ADMIN: 'tools-runtime-password', UUID: '00000000-0000-4000-8000-000000000001', OFF_LOG: 'true' },
  outboundService: async request => {
    const entry = {
      url: request.url, method: request.method,
      cookie: request.headers.get('Cookie'), authorization: request.headers.get('Authorization'),
      body: request.method === 'POST' ? await request.text() : null,
    };
    outgoing.push(entry);
    return fixture(entry);
  },
}));
after(() => mf.dispose());

test('built administrator tools reach remote fixtures in workerd and reject redirects', { timeout: 20000 }, async t => {
  const login = await mf.dispatchFetch(`${origin}/login`, {
    method: 'POST', headers: { Origin: origin, 'User-Agent': 'Brclio-Tools-Runtime-QA' }, body: 'password=tools-runtime-password',
  });
  assert.equal(login.status, 200);
  const headers = {
    Origin: origin, 'User-Agent': 'Brclio-Tools-Runtime-QA',
    Cookie: login.headers.get('Set-Cookie').split(';')[0], Authorization: 'browser-only-fixture', 'Content-Type': 'application/json',
  };
  const request = (path, input) => mf.dispatchFetch(origin + path, {
    method: input === undefined ? 'GET' : 'POST', headers,
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const kv = await mf.getKVNamespace('KV');
  const savedCredentials = JSON.stringify({ BotToken: '111:stored_fixture_token', ChatID: 'old-chat' });
  await kv.put('tg.json', savedCredentials);
  const candidate = { useInput: true, sendMessage: true, BotToken: '123:candidate_fixture_token', ChatID: '-1001234567' };

  await t.test('converter validation performs its GET and returns the version', async () => {
    const start = outgoing.length;
    fixture = entry => {
      assert.equal(entry.url, 'https://converter.example.com/version');
      assert.equal(entry.method, 'GET');
      return new Response('subconverter v0.9.0 fixture');
    };
    const response = await request('/admin/testSubAPI', { url: 'https://converter.example.com/sub?ignored=true' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, url: 'https://converter.example.com', version: 'subconverter v0.9.0 fixture' });
    assert.equal(outgoing.length - start, 1);
  });

  await t.test('catalogue JSON loads from the fixed source', async () => {
    const start = outgoing.length;
    const source = 'https://raw.githubusercontent.com/cmliu/cmliu/main/SUBAPI.json';
    const data = [{ label: 'Local fixture', value: 'converter.example.com' }];
    fixture = entry => { assert.equal(entry.url, source); return Response.json(data); };
    const response = await request('/admin/catalog?kind=subapi');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, kind: 'subapi', source, data });
    assert.equal(outgoing.length - start, 1);
  });

  await t.test('Telegram candidate validation checks and sends without saving credentials', async () => {
    const start = outgoing.length;
    fixture = entry => {
      assert.equal(entry.method, 'POST');
      if (entry.url === `https://api.telegram.org/bot${candidate.BotToken}/getMe`) {
        return Response.json({ ok: true, result: { is_bot: true, username: 'runtime_fixture_bot' } });
      }
      assert.equal(entry.url, `https://api.telegram.org/bot${candidate.BotToken}/sendMessage`);
      assert.equal(JSON.parse(entry.body).chat_id, candidate.ChatID);
      return Response.json({ ok: true });
    };
    const response = await request('/admin/testTelegram', candidate);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.sent, true);
    assert.equal(result.username, 'runtime_fixture_bot');
    assert.match(result.message, /尚未保存/);
    assert.equal(outgoing.length - start, 2);
    assert.equal(await kv.get('tg.json'), savedCredentials);
  });

  await t.test('redirect responses are rejected before a second remote request', async () => {
    const cases = [
      ...[300, 301, 302, 303, 304, 307, 308].map(status => ({ path: '/admin/testSubAPI', input: { url: 'https://converter.example.com' }, status })),
      { path: '/admin/catalog?kind=subapi', status: 302 },
      { path: '/admin/testTelegram', input: candidate, status: 307 },
    ];
    for (const { path, input, status } of cases) {
      const start = outgoing.length;
      const location = 'https://redirect.invalid/should-never-be-requested?private=fixture';
      fixture = () => new Response(null, { status, headers: { Location: location } });
      const response = await request(path, input);
      assert.equal(response.status, 502, `${path}: HTTP ${status}`);
      const result = await response.json();
      assert.equal(result.success, false);
      assert.match(result.error, /重定向/);
      assert.equal(JSON.stringify(result).includes(location), false);
      assert.equal(JSON.stringify(result).includes(candidate.BotToken), false);
      assert.equal(outgoing.length - start, 1, 'Redirect must not trigger a follow-up fetch or Telegram send');
    }
    assert.equal(await kv.get('tg.json'), savedCredentials);
  });

  await t.test('a redirect from Telegram sendMessage is not followed', async () => {
    const start = outgoing.length;
    fixture = entry => entry.url.endsWith('/getMe')
      ? Response.json({ ok: true, result: { is_bot: true } })
      : new Response(null, { status: 308, headers: { Location: 'https://redirect.invalid/telegram' } });
    const response = await request('/admin/testTelegram', candidate);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /重定向/);
    assert.equal(outgoing.length - start, 2, 'Only getMe and the original sendMessage request may run');
    assert.equal(await kv.get('tg.json'), savedCredentials);
  });

  for (const entry of outgoing) {
    assert.equal(entry.cookie, null, 'Browser cookies must not leave the Worker');
    assert.equal(entry.authorization, null, 'Browser Authorization must not leave the Worker');
    assert.equal(new URL(entry.url).hostname === 'redirect.invalid', false);
  }
});
