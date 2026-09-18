// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Exercise the production subscription handler with controlled Cloudflare
// request metadata. Converter and CIDR fetches stay inside local fixtures.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'https://carrier.example.net';
const converterOrigin = 'https://converter.example.net';
const overseas = { colo: 'TEST', country: 'US', asn: 64512 };
const telecom = { colo: 'TEST', country: 'CN', asn: 4134 };
const unicom = { colo: 'TEST', country: 'CN', asn: 4837 };
const pools = {
  ct: { path: '/cmliu/cmliu/main/CF-CIDR/ct.txt', host: '198.51.100.1', label: 'CF电信优选1' },
  cu: { path: '/cmliu/cmliu/main/CF-CIDR/cu.txt', host: '198.51.100.2', label: 'CF联通优选1' },
  cmcc: { path: '/cmliu/cmliu/main/CF-CIDR/cmcc.txt', host: '198.51.100.3', label: 'CF移动优选1' },
  cf: { path: '/cmliu/cmliu/main/CF-CIDR.txt', host: '198.51.100.4', label: 'CF官方优选1' },
};
const converted = [], fetchedPools = [], blocked = [];
let token;

const mf = new Miniflare(convertV4MiniflareOptions({
  modulesRoot: root,
  modules: [
    { type: 'ESModule', path: `${root}/subscription-carrier-fixture.mjs`, contents: `
      import worker from './dist/_worker.js';
      export default { fetch(request, env, ctx) {
        Object.defineProperty(request, 'cf', { value: JSON.parse(request.headers.get('x-fixture-cf') || '{}') });
        return worker.fetch(request, env, ctx);
      } };
    ` },
    { type: 'ESModule', path: `${root}/dist/_worker.js` },
  ],
  compatibilityDate: '2026-09-01', cf: false, kvNamespaces: ['KV'],
  bindings: { ADMIN: 'local-carrier-test-password', UUID: '00000000-0000-4000-8000-000000000001', OFF_LOG: 'true' },
  outboundService: request => {
    const url = new URL(request.url);
    if (url.origin === converterOrigin && url.pathname === '/sub') {
      converted.push(url);
      return new Response('proxies: []\n', { headers: { 'Content-Type': 'application/x-yaml' } });
    }
    const pool = Object.values(pools).find(pool => url.origin === 'https://raw.githubusercontent.com' && url.pathname === pool.path);
    if (pool) {
      fetchedPools.push(url.pathname);
      return new Response(`${pool.host}/32\n`);
    }
    blocked.push(request.url);
    return new Response('Unexpected external fetch blocked by local carrier fixture', { status: 599 });
  },
}));

before(async () => {
  const login = await mf.dispatchFetch(origin + '/login', {
    method: 'POST', headers: { Origin: origin, 'User-Agent': 'Carrier-QA' }, body: 'password=local-carrier-test-password',
  });
  assert.equal(login.status, 200);
  const headers = { Origin: origin, 'User-Agent': 'Carrier-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  const response = await mf.dispatchFetch(origin + '/admin/config.json', { headers });
  assert.equal(response.status, 200);
  const config = await response.json();
  token = config.优选订阅生成.TOKEN;
  config.优选订阅生成.本地IP库.随机数量 = 1;
  config.优选订阅生成.本地IP库.指定端口 = 443;
  config.订阅转换配置.SUBAPI = converterOrigin;
  const saved = await mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers, body: JSON.stringify(config) });
  assert.equal(saved.status, 200, await saved.text());
});

after(async () => {
  await mf.dispose();
  assert.deepEqual(blocked, [], 'All application fetches must use the expected local fixtures');
});

function subscriptionURL(target, value) {
  const url = new URL('/sub', origin);
  url.searchParams.set('target', target);
  url.searchParams.set('token', token);
  if (value !== undefined) url.searchParams.set('cnIspCode', value);
  return url;
}

function request(url, cf, ua = 'Clash.Meta') {
  return mf.dispatchFetch(url, { headers: { 'x-fixture-cf': JSON.stringify(cf), 'User-Agent': ua } });
}

async function expectMixedPool(url, cf, expected, ua = 'subconverter') {
  const previous = fetchedPools.length;
  const response = await request(url, cf, ua);
  assert.equal(response.status, 200);
  const links = Buffer.from(await response.text(), 'base64').toString('utf8').trim().split('\n');
  assert.equal(links.length, 1);
  const link = new URL(links[0]);
  assert.equal(link.hostname, pools[expected].host);
  assert.equal(link.port, '443');
  assert.equal(decodeURIComponent(link.hash.slice(1)), pools[expected].label);
  assert.deepEqual(fetchedPools.slice(previous), [pools[expected].path]);
}

async function expectConvertedPool(value, cf, expected) {
  const previous = converted.length;
  const response = await request(subscriptionURL('clash', value), cf);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(converted.length, previous + 1);
  const conversion = converted.at(-1);
  assert.equal(conversion.searchParams.get('target'), 'clash');
  const mixedURL = new URL(conversion.searchParams.get('url'));
  assert.equal(mixedURL.origin, origin);
  assert.equal(mixedURL.pathname, '/sub');
  assert.equal(mixedURL.searchParams.get('target'), 'mixed');
  assert.equal(mixedURL.searchParams.get('cnIspCode'), expected);
  // The converter makes a new overseas request: the original selection must
  // still choose the same CIDR source and produce the corresponding node.
  await expectMixedPool(mixedURL, overseas, expected);
}

test('Clash conversion preserves explicit normalized carrier selections through its overseas callback', { timeout: 15000 }, async () => {
  for (const [value, cf, expected] of [
    ['ct', overseas, 'ct'],
    [' CT ', unicom, 'ct'],
    ['Cu', overseas, 'cu'],
    ['cMcC', overseas, 'cmcc'],
    ['CF', telecom, 'cf'],
  ]) await expectConvertedPool(value, cf, expected);
});

test('missing or invalid carrier selections fall back to actual request metadata before conversion', { timeout: 15000 }, async () => {
  for (const [value, cf, expected] of [
    [undefined, telecom, 'ct'],
    ['', unicom, 'cu'],
    ['not-a-carrier', telecom, 'ct'],
    ['ct&cnIspCode=cu', overseas, 'cf'],
    [' ', { colo: 'TEST', country: 'CN', asn: 64512, asOrganization: 'China Mobile Communications' }, 'cmcc'],
  ]) await expectConvertedPool(value, cf, expected);
});

test('direct mixed subscriptions use the same explicit carrier normalization and fallback', { timeout: 15000 }, async () => {
  for (const [value, cf, expected] of [
    [' CT ', overseas, 'ct'],
    ['Cu', telecom, 'cu'],
    ['cMcC', overseas, 'cmcc'],
    ['CF', telecom, 'cf'],
    ['invalid', telecom, 'ct'],
    [undefined, overseas, 'cf'],
  ]) await expectMixedPool(subscriptionURL('mixed', value), cf, expected, 'V2rayN');
});
