import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHmac } from 'node:crypto';

const origin = 'https://panel.example.com';
const password = 'local-test-password-with-long-entropy';
const uuid = '00000000-0000-4000-8000-000000000001';
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/_worker.js', compatibilityDate: '2026-09-01', kvNamespaces: ['KV'], bindings: { ADMIN: password, UUID: uuid, OFF_LOG: 'true' } }));
after(() => mf.dispose());
async function request(path, { cookie, method = 'GET', body, headers = {} } = {}) {
  return mf.dispatchFetch(origin + path, { method, body, redirect: 'manual', headers: { 'User-Agent': 'Brclio-QA', ...(cookie ? { Cookie: cookie } : {}), ...headers } });
}
async function signIn() {
  const response = await request('/login', { method: 'POST', body: new URLSearchParams({ password }).toString(), headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict; Secure/);
  return response.headers.get('Set-Cookie').split(';')[0];
}
test('the complete management loop works on the built Worker', async t => {
  let cookie;
  let config;
  await t.test('serves self-contained login and protects HTML/API', async () => {
    const page = await request('/login');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Brclio/);
    assert.equal((await request('/admin')).headers.get('Location'), '/login');
    assert.equal((await request('/admin/config.json')).status, 401);
    const script = await request('/assets/login.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('Content-Type'), /javascript/);
    assert.match(script.headers.get('Content-Security-Policy'), /script-src 'self'/);
  });
  await t.test('rejects incorrect password and cross-origin login', async () => {
    const wrong = await request('/login', { method: 'POST', body: 'password=wrong' });
    assert.equal(wrong.status, 401);
    assert.ok((await wrong.json()).error);
    assert.equal((await request('/login', { method: 'POST', body: `password=${password}`, headers: { Origin: 'https://outside.example' } })).status, 403);
    cookie = await signIn();
  });
  await t.test('loads defaults, persists updates and retains future fields', async () => {
    const response = await request('/admin/config.json', { cookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    config = await response.json();
    assert.equal(config.UUID, uuid);
    assert.equal(config.协议类型, 'vless');
    config.优选订阅生成.SUBNAME = 'Brclio QA 中文';
    config.futureField = { keep: 'yes' };
    const saved = await request('/admin/config.json', { cookie, method: 'POST', body: JSON.stringify(config), headers: { Origin: origin, 'Content-Type': 'application/json' } });
    assert.equal(saved.status, 200);
    const loaded = await (await request('/admin/config.json', { cookie })).json();
    assert.equal(loaded.优选订阅生成.SUBNAME, 'Brclio QA 中文');
    assert.deepEqual(loaded.futureField, { keep: 'yes' });
  });
  await t.test('rejects malformed schemas and cross-site writes without changing config', async () => {
    assert.equal((await request('/admin/config.json', { cookie, method: 'POST', body: JSON.stringify({ UUID: uuid, HOST: 'panel.example.com' }) })).status, 400);
    assert.equal((await request('/admin/config.json', { cookie, method: 'POST', body: JSON.stringify(config), headers: { Origin: 'https://outside.example' } })).status, 403);
    assert.equal((await (await request('/admin/config.json', { cookie })).json()).优选订阅生成.SUBNAME, 'Brclio QA 中文');
  });
  await t.test('saves custom addresses and generates VLESS/Trojan/SS subscriptions', async () => {
    const addresses = 'node.example.net:443#QA 节点';
    assert.equal((await request('/admin/ADD.txt', { cookie, method: 'POST', body: addresses })).status, 200);
    assert.equal(await (await request('/admin/ADD.txt', { cookie })).text(), addresses);
    config.优选订阅生成.本地IP库.随机IP = false;
    config.优选订阅生成.local = true;
    for (const protocol of ['vless', 'trojan', 'ss']) {
      config.协议类型 = protocol;
      assert.equal((await request('/admin/config.json', { cookie, method: 'POST', body: JSON.stringify(config) })).status, 200);
      const sub = await request(`/sub?token=${config.优选订阅生成.TOKEN}&b64`);
      assert.equal(sub.status, 200);
      const decoded = Buffer.from(await sub.text(), 'base64').toString('utf8');
      assert.ok(decoded.includes(`${protocol}://`), `missing ${protocol} link`);
      assert.ok(decoded.includes('node.example.net'));
    }
  });
  await t.test('stores credentials separately, preserves omitted values and clears explicitly', async () => {
    const kv = await mf.getKVNamespace('KV');
    assert.equal((await request('/admin/cf.json', { cookie, method: 'POST', body: JSON.stringify({ AccountID: 'test-account', APIToken: 'test-token' }) })).status, 200);
    assert.equal((await request('/admin/cf.json', { cookie, method: 'POST', body: JSON.stringify({ APIToken: 'replacement-token' }) })).status, 200);
    assert.equal(JSON.parse(await kv.get('cf.json')).AccountID, 'test-account');
    assert.equal((await request('/admin/cf.json', { cookie, method: 'POST', body: JSON.stringify({ APIToken: 'a***b' }) })).status, 400);
    assert.equal((await request('/admin/cf.json', { cookie, method: 'POST', body: '{"init":true}' })).status, 200);
    assert.equal(JSON.parse(await kv.get('cf.json')).APIToken, null);
    assert.equal((await request('/admin/tg.json', { cookie, method: 'POST', body: JSON.stringify({ BotToken: 'test-bot', ChatID: 'test-chat' }) })).status, 200);
    assert.equal((await request('/admin/tg.json', { cookie, method: 'POST', body: JSON.stringify({ ChatID: 'replacement-chat' }) })).status, 200);
    assert.equal(JSON.parse(await kv.get('tg.json')).BotToken, 'test-bot');
    assert.equal((await request('/admin/tg.json', { cookie, method: 'POST', body: '{"init":true}' })).status, 200);
  });
  await t.test('reset requires POST and logout invalidates the signed session', async () => {
    assert.equal((await request('/admin/init', { cookie })).status, 405);
    assert.equal((await (await request('/admin/config.json', { cookie })).json()).优选订阅生成.SUBNAME, 'Brclio QA 中文');
    const reset = await request('/admin/init', { cookie, method: 'POST' });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).优选订阅生成.SUBNAME, 'Brclio Edge');
    assert.equal((await request('/admin/config.json', { cookie: cookie.replace(/.$/, x => x === 'a' ? 'b' : 'a') })).status, 401);
    const expires = Math.floor(Date.now() / 1000) - 1;
    const nonce = '1'.repeat(32);
    const key = `勿动此默认密钥，有需求请自行通过添加变量KEY进行修改\u0000${password}`;
    const signature = createHmac('sha256', key).update(`${expires}.${nonce}.Brclio-QA`).digest('hex');
    assert.equal((await request('/admin/config.json', { cookie: `auth=${expires}.${nonce}.${signature}` })).status, 401, 'even correctly signed expired sessions must fail');
    assert.equal((await request('/logout', { cookie })).status, 302);
    assert.equal((await request('/admin/config.json', { cookie })).status, 401);
  });
});
test('missing bindings show a local setup page', async () => {
  for (const bindings of [{}, { ADMIN: password }]) {
    const bare = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/_worker.js', compatibilityDate: '2026-09-01', bindings }));
    try {
      const result = await bare.dispatchFetch(`${origin}/admin`);
      assert.equal(result.status, 503);
      const content = await result.text();
      assert.match(content, /ADMIN/);
      assert.match(content, /KV/);
    } finally { await bare.dispose(); }
  }
});
