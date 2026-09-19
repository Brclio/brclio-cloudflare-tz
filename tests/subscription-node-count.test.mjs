// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Count and uniqueness are checked through the built Worker and a local
// converter callback. No fixture may contact a production service.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://node-count.example.net';
const converterOrigin = 'https://count-converter.example.net';
const uuid = '00000000-0000-4000-8000-000000000001';
const largePool = '198.18.0.0/15\n';
const blocked = [], poolRequests = [], conversions = [];
let cidrText = largePool;

function decodeNodes(body) {
  const text = Buffer.from(body, 'base64').toString('utf8').trim();
  return text ? text.split('\n').map(line => new URL(line)) : [];
}

function assertUniqueCount(nodes, expected) {
  assert.equal(nodes.length, expected, 'Subscription must contain the requested number of available nodes');
  assert.equal(new Set(nodes.map(node => node.hostname)).size, expected, 'Every node must use a different IP');
  assert.equal(new Set(nodes.map(node => node.hash)).size, expected, 'Generated node names must remain distinct');
}

const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
  compatibilityDate: '2026-09-01',
  cf: false,
  kvNamespaces: ['KV'],
  bindings: { ADMIN: 'local-node-count-password', UUID: uuid, OFF_LOG: 'true' },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.origin === 'https://raw.githubusercontent.com'
      && /^\/cmliu\/cmliu\/main\/CF-CIDR(?:\/(?:ct|cu|cmcc))?\.txt$/.test(url.pathname)) {
      poolRequests.push(url.pathname);
      return new Response(cidrText, { headers: { 'Content-Type': 'text/plain' } });
    }
    if (url.origin === converterOrigin && url.pathname === '/sub') {
      const callback = new URL(url.searchParams.get('url'));
      assert.equal(callback.origin, origin);
      assert.equal(callback.pathname, '/sub');
      assert.equal(callback.searchParams.get('target'), 'mixed');
      assert.equal(url.searchParams.get('target'), 'clash');
      const response = await mf.dispatchFetch(callback, { headers: { 'User-Agent': 'subconverter' } });
      assert.equal(response.status, 200);
      const nodes = decodeNodes(await response.text());
      conversions.push({ callback, nodes });
      const yaml = 'proxies:\n' + nodes.map(node => {
        const name = JSON.stringify(decodeURIComponent(node.hash.slice(1)));
        return `  - {name: ${name}, type: vless, server: ${node.hostname}, port: ${node.port}, uuid: ${node.username}, network: ws}`;
      }).join('\n') + '\n';
      return new Response(yaml, { headers: { 'Content-Type': 'application/x-yaml' } });
    }
    blocked.push(request.url);
    return new Response('Unexpected external request blocked by node-count fixture', { status: 599 });
  },
}));

after(async () => {
  await mf.dispose();
  assert.deepEqual(blocked, [], 'All outbound requests must use local fixtures');
});

test('random node counts survive configuration, generation and conversion without duplicate IPs', { timeout: 30000 }, async t => {
  const login = await mf.dispatchFetch(origin + '/login', {
    method: 'POST', headers: { Origin: origin, 'User-Agent': 'Node-Count-QA' }, body: 'password=local-node-count-password',
  });
  assert.equal(login.status, 200);
  const headers = { Origin: origin, 'User-Agent': 'Node-Count-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  const kv = await mf.getKVNamespace('KV');
  const readConfig = async () => {
    const response = await mf.dispatchFetch(origin + '/admin/config.json', { headers });
    assert.equal(response.status, 200);
    return response.json();
  };
  const saveConfig = config => mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers, body: JSON.stringify(config) });
  const defaults = await readConfig();
  const token = defaults.优选订阅生成.TOKEN;
  const readNodes = async () => {
    const response = await mf.dispatchFetch(`${origin}/sub?token=${token}&b64&cnIspCode=cf`);
    assert.equal(response.status, 200);
    return decodeNodes(await response.text());
  };
  const configure = async count => {
    const config = structuredClone(defaults);
    config.优选订阅生成.本地IP库.随机数量 = count;
    config.优选订阅生成.本地IP库.指定端口 = 443;
    config.订阅转换配置.SUBAPI = converterOrigin;
    const response = await saveConfig(config);
    assert.equal(response.status, 200, await response.text());
    return config;
  };

  await t.test('a fresh installation generates 64 distinct candidates', async () => {
    assert.equal(defaults.优选订阅生成.本地IP库.随机数量, 64);
    assertUniqueCount(await readNodes(), 64);
    assert.equal(await kv.get('ADD.txt'), null);
  });

  for (const count of [128, 1000]) {
    await t.test(`saving ${count} produces ${count} distinct mixed nodes`, async () => {
      await configure(count);
      assert.equal((await readConfig()).优选订阅生成.本地IP库.随机数量, count);
      const previous = poolRequests.length;
      const nodes = await readNodes();
      assertUniqueCount(nodes, count);
      assert.ok(nodes.every(node => /^198\.(?:18|19)\./.test(node.hostname)));
      assert.ok(nodes.every(node => node.port === '443'));
      assert.equal(poolRequests.length - previous, 1, 'Increasing the count must not add per-node network calls');
    });
  }

  for (const count of [16, 37]) {
    await t.test(`an existing explicit count of ${count} is retained without rewriting KV`, async () => {
      const legacy = JSON.stringify({ 优选订阅生成: { 本地IP库: { 随机数量: count } } });
      await kv.put('config.json', legacy);
      const loaded = await readConfig();
      assert.equal(loaded.优选订阅生成.本地IP库.随机数量, count);
      assertUniqueCount(await readNodes(), count);
      assert.equal(await kv.get('config.json'), legacy, 'A read must not migrate an explicit saved count');
    });
  }

  await t.test('malformed legacy counts are safely normalized in memory without rewriting KV', async () => {
    for (const [count, expected] of [[Number.MAX_SAFE_INTEGER, 1000], [-1, 64], [1.5, 64], ['128', 64]]) {
      const legacy = JSON.stringify({ 优选订阅生成: { 本地IP库: { 随机数量: count } } });
      await kv.put('config.json', legacy);
      const loaded = await readConfig();
      assert.equal(loaded.优选订阅生成.本地IP库.随机数量, expected, `Unexpected normalization for ${JSON.stringify(count)}`);
      assertUniqueCount(await readNodes(), expected);
      assert.equal(await kv.get('config.json'), legacy, 'Reading or generating candidates must not rewrite an old configuration');
    }
  });

  await t.test('invalid quantities are rejected without changing the saved configuration', async () => {
    const valid = await configure(128);
    const persisted = await kv.get('config.json');
    for (const count of [0, -1, 1001, 1.5, '128', null, Number.MAX_SAFE_INTEGER]) {
      const config = structuredClone(valid);
      config.优选订阅生成.本地IP库.随机数量 = count;
      const response = await saveConfig(config);
      assert.equal(response.status, 400, `Expected count ${JSON.stringify(count)} to be rejected`);
      assert.match((await response.json()).error, /1[–-]1000/);
      assert.equal(await kv.get('config.json'), persisted);
    }
  });

  await t.test('overlapping and duplicate small CIDRs return their unique capacity', async () => {
    await configure(1000);
    cidrText = '198.51.100.0/30\n198.51.100.0/30\n198.51.100.2/31\n198.51.100.3/32\ninvalid-row\n300.2.3.4/24';
    const nodes = await readNodes();
    assertUniqueCount(nodes, 4);
    assert.deepEqual(nodes.map(node => node.hostname).sort(), ['198.51.100.0', '198.51.100.1', '198.51.100.2', '198.51.100.3']);
    cidrText = '198.51.100.7/32\n198.51.100.7/32';
    const single = await readNodes();
    assertUniqueCount(single, 1);
    assert.equal(single[0].hostname, '198.51.100.7');
    cidrText = largePool;
  });

  await t.test('the entire IPv4 range is sampled without overflowing its address capacity', async () => {
    await configure(1000);
    cidrText = '0.0.0.0/0\n255.255.255.255/32';
    const nodes = await readNodes();
    assertUniqueCount(nodes, 1000);
    assert.ok(nodes.every(node => node.hostname.split('.').length === 4 && node.hostname.split('.').every(octet => Number(octet) >= 0 && Number(octet) <= 255)));
    cidrText = largePool;
  });

  await t.test('custom addresses remain unchanged when random generation is disabled', async () => {
    const config = await configure(1000);
    config.优选订阅生成.本地IP库.随机IP = false;
    assert.equal((await saveConfig(config)).status, 200);
    const saved = '198.51.100.8:443#Saved one\nnode.example.net:8443#Saved two\n';
    await kv.put('ADD.txt', saved);
    const previous = poolRequests.length;
    const nodes = await readNodes();
    assert.deepEqual(nodes.map(node => node.host), ['198.51.100.8:443', 'node.example.net:8443']);
    assert.deepEqual(nodes.map(node => decodeURIComponent(node.hash.slice(1))), ['Saved one', 'Saved two']);
    assert.equal(poolRequests.length, previous);
    assert.equal(await kv.get('ADD.txt'), saved);
    await kv.delete('ADD.txt');
  });

  await t.test('Clash conversion retrieves and returns all 1000 mixed source nodes', async () => {
    await configure(1000);
    const previous = conversions.length;
    const response = await mf.dispatchFetch(`${origin}/sub?token=${token}&clash&cnIspCode=cf`, { headers: { 'User-Agent': 'Clash.Meta' } });
    assert.equal(response.status, 200);
    assert.equal(conversions.length, previous + 1);
    const conversion = conversions.at(-1);
    assert.equal(conversion.callback.searchParams.get('cnIspCode'), 'cf');
    assertUniqueCount(conversion.nodes, 1000);
    const yaml = await response.text();
    const servers = [...yaml.matchAll(/\bserver: ([\d.]+)/g)].map(match => match[1]);
    assert.equal(servers.length, 1000);
    assert.equal(new Set(servers).size, 1000);
    assert.deepEqual(servers, conversion.nodes.map(node => node.hostname));
    assert.equal((yaml.match(new RegExp(`uuid: ${uuid}`, 'g')) || []).length, 1000);
  });
});
