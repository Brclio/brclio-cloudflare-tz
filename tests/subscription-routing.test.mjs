// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Test the actual subscription handlers using only synthetic local sources.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'https://subscription-route.example';
const uuid = '00000000-0000-4000-8000-000000000001';
const placeholder = '00000000-0000-4000-8000-000000000000';
const addresses = ['198.51.100.10:2053', '198.51.100.1:8443', 'www.host.example:2083', 'host.example:2096', '[2001:db8::10]:443', '[2001:db8::1]:8443'];
const blocked = [];
let config, headers, converted = '';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: `${root}/dist/_worker.js`,
  compatibilityDate: '2026-09-01', cf: false, kvNamespaces: ['KV'],
  bindings: { ADMIN: 'local-sub-route-password', UUID: uuid, OFF_LOG: 'true' },
  outboundService: request => {
    const url = new URL(request.url);
    if (url.href === 'https://pool.example/ips?proxyip=true') return new Response(addresses.map((address, index) => `${address}#Node${index}`).join('\n'));
    if (url.origin === 'https://converter.example' && url.pathname === '/sub') return new Response(converted);
    blocked.push(request.url);
    return new Response('External fetch blocked', { status: 599 });
  },
}));

before(async () => {
  const login = await mf.dispatchFetch(origin + '/login', { method: 'POST', headers: { Origin: origin, 'User-Agent': 'Sub-Route-QA' }, body: 'password=local-sub-route-password' });
  assert.equal(login.status, 200);
  headers = { Origin: origin, 'User-Agent': 'Sub-Route-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  config = await (await mf.dispatchFetch(origin + '/admin/config.json', { headers })).json();
  config.优选订阅生成.本地IP库.随机IP = false;
  config.订阅转换配置.SUBAPI = 'https://converter.example';
  config.ECH = true;
  config.ECHConfig = { DNS: 'https://doh.example/dns-query', SNI: 'ech.example' };
  await (await mf.getKVNamespace('KV')).put('ADD.txt', 'https://pool.example/ips?proxyip=true');
  const saved = await mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers, body: JSON.stringify(config) });
  assert.equal(saved.status, 200, await saved.text());
});

after(async () => { await mf.dispose(); assert.deepEqual(blocked, []); });

test('ProxyIP pool matching uses an exact host for IPv4, domains and IPv6', async () => {
  const response = await mf.dispatchFetch(origin + '/sub?b64&token=' + config.优选订阅生成.TOKEN);
  assert.equal(response.status, 200);
  const nodes = Buffer.from(await response.text(), 'base64').toString().trim().split('\n').map(line => new URL(line));
  assert.equal(nodes.length, addresses.length);
  for (const node of nodes) {
    const index = Number(decodeURIComponent(node.hash.slice(1)).replace('Node', ''));
    assert.equal(node.searchParams.get('path'), '/proxyip=' + addresses[index]);
  }
});

for (const style of ['flow', 'block']) {
  for (const quote of ['', '"', "'"]) {
    for (const protocol of ['vless', 'trojan']) {
      test(`ECH matches ${style} ${protocol} credentials with ${JSON.stringify(quote)} quotes`, async () => {
        const field = protocol === 'trojan' ? 'password' : 'uuid';
        const credential = quote + placeholder + quote;
        converted = style === 'flow'
          ? `proxies:\n  - {name: Local, type: ${protocol}, server: example.com, port: 443, ${field}: ${credential}, network: ws}\n`
          : `proxies:\n  - name: Local\n    type: ${protocol}\n    server: example.com\n    port: 443\n    ${field}: ${credential}\n    network: ws\n`;
        const response = await mf.dispatchFetch(origin + '/sub?clash&token=' + config.优选订阅生成.TOKEN, { headers: { 'User-Agent': 'Clash.Meta' } });
        assert.equal(response.status, 200);
        const body = await response.text();
        assert.equal((body.match(/ech-opts:/g) || []).length, 1);
        assert.match(body, /query-server-name:\s*ech\.example/);
        assert.ok(body.includes(uuid));
      });
    }
  }
}

for (const [label, accounts] of [
  ['invalid credentials', ['BrokenSecret@127.0.0.1:1080']],
  ['invalid ports', ['User:Secret@127.0.0.1:44x3', 'User:Secret@127.0.0.1:99999']],
  ['empty addresses', ['']],
]) {
  test(`explicit chain remarks with ${label} fail closed without reflecting credentials`, async () => {
    const kv = await mf.getKVNamespace('KV');
    for (const protocol of ['socks5', 'http', 'https', 'turn', 'sstp']) {
      for (const account of accounts) {
        await kv.put('ADD.txt', `198.51.100.1:443#Local$${protocol}://${account}`);
        const response = await mf.dispatchFetch(origin + '/sub?b64&token=' + config.优选订阅生成.TOKEN);
        assert.equal(response.status, 400, protocol);
        assert.equal(await response.text(), 'Invalid proxy route');
      }
    }
  });
}
