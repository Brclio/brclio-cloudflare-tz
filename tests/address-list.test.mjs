// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://addresses.example.com';
const outgoing = [];
let cidrText = '';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
  compatibilityDate: '2025-11-04',
  cf: false,
  kvNamespaces: ['KV'],
  bindings: { ADMIN: 'address-list-password', UUID: '00000000-0000-4000-8000-000000000001', OFF_LOG: 'true' },
  outboundService: request => {
    outgoing.push(request.url);
    if (!request.url.startsWith('https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR')) throw new Error(`Unexpected outbound request: ${request.url}`);
    return new Response(cidrText, { headers: { 'Content-Type': 'text/plain' } });
  },
}));
after(() => mf.dispose());

test('the address editor reads stored text only while subscriptions safely generate random candidates', { timeout: 15000 }, async t => {
  const login = await mf.dispatchFetch(`${origin}/login`, { method: 'POST', body: 'password=address-list-password', headers: { Origin: origin, 'User-Agent': 'Brclio-Address-QA' } });
  assert.equal(login.status, 200);
  const headers = { Origin: origin, 'User-Agent': 'Brclio-Address-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0] };
  const request = path => mf.dispatchFetch(origin + path, { headers });
  const kv = await mf.getKVNamespace('KV');

  await t.test('an empty address list returns an empty string without outbound fetches or generating KV data', async () => {
    const response = await request('/admin/ADD.txt');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(outgoing.length, 0);
    assert.equal(await kv.get('ADD.txt'), null);
    assert.equal(await kv.get('config.json'), null, 'Reading stored text should not initialize unrelated main configuration');
  });
  await t.test('saved text is returned byte-for-byte without triggering configured usage services', async () => {
    const saved = 'node.example.net:443#我的节点\n';
    await kv.put('ADD.txt', saved);
    await kv.put('cf.json', JSON.stringify({ UsageAPI: 'https://must-not-be-fetched.example/usage' }));
    const response = await request('/admin/ADD.txt');
    assert.equal(await response.text(), saved);
    assert.equal(outgoing.length, 0);
    await kv.delete('cf.json');
    await kv.delete('ADD.txt');
  });

  const config = await (await request('/admin/config.json')).json();
  const readCandidateHosts = async () => {
    const response = await request(`/sub?token=${config.优选订阅生成.TOKEN}&b64`);
    assert.equal(response.status, 200);
    const links = Buffer.from(await response.text(), 'base64').toString('utf8').trim().split('\n');
    assert.equal(links.length, 16);
    return links.map(link => new URL(link).hostname);
  };
  await t.test('empty and invalid CIDR bodies use the fixed Cloudflare fallback', async () => {
    for (const text of ['', ' \n\r\t', '<html>upstream unavailable</html>', '999.1.2.3/24\n192.0.2.0/33\n192.0.2.0/-1']) {
      cidrText = text;
      for (const host of await readCandidateHosts()) {
        const octets = host.split('.').map(Number);
        assert.equal(octets[0], 104);
        assert.ok(octets[1] >= 16 && octets[1] <= 23, `Expected 104.16.0.0/13 fallback, got ${host}`);
      }
    }
  });
  await t.test('valid CIDRs are retained while malformed rows are discarded', async () => {
    cidrText = 'bad-row\n198.51.100.7/32\n300.2.3.4/24';
    assert.deepEqual(await readCandidateHosts(), Array(16).fill('198.51.100.7'));
    assert.equal(await kv.get('ADD.txt'), null, 'Subscription candidates must not masquerade as a saved address list');
  });
});
