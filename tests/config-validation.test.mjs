// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://validation.example.com';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/_worker.js', import.meta.url)),
  compatibilityDate: '2025-11-04',
  cf: false,
  kvNamespaces: ['KV'],
  bindings: {
    ADMIN: 'config-validation-test-password',
    UUID: '00000000-0000-4000-8000-000000000001',
    OFF_LOG: 'true',
  },
}));
after(() => mf.dispose());

test('configuration writes preserve supported wildcard hosts and reject values that break later reads', { timeout: 15000 }, async t => {
  const login = await mf.dispatchFetch(`${origin}/login`, {
    method: 'POST',
    headers: { Origin: origin, 'User-Agent': 'Brclio-Schema-QA' },
    body: 'password=config-validation-test-password',
  });
  assert.equal(login.status, 200);
  const headers = { Origin: origin, 'User-Agent': 'Brclio-Schema-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  const read = () => mf.dispatchFetch(`${origin}/admin/config.json`, { headers });
  const save = config => mf.dispatchFetch(`${origin}/admin/config.json`, { method: 'POST', headers, body: JSON.stringify(config) });
  const config = await (await read()).json();
  config.HOSTS = ['*.example.com', 'edge-*.example.com'];
  config.futureSetting = { version: 2, enabled: true };
  assert.equal((await save(config)).status, 200);
  const persisted = await (await read()).json();
  assert.deepEqual(persisted.HOSTS, config.HOSTS);
  assert.deepEqual(persisted.futureSetting, config.futureSetting);

  const corruptions = [
    ['numeric ProxyIP template', value => { value.反代.PROXYIP = 'example.com:443'; value.反代.路径模板.PROXYIP = 123; }],
    ['missing selected proxy template text', value => { value.反代.SOCKS5.启用 = 'socks5'; value.反代.SOCKS5.账号 = 'example.com:1080'; value.反代.路径模板.SOCKS5.标准 = null; }],
    ['string random-port sentinel', value => { value.优选订阅生成.本地IP库.指定端口 = '-1'; }],
    ['truthy false string', value => { value.优选订阅生成.本地IP库.随机IP = 'false'; }],
    ['unsupported Shadowsocks cipher', value => { value.SS.加密方式 = 'not-supported'; }],
    ['Shadowsocks over gRPC', value => { value.协议类型 = 'ss'; value.传输协议 = 'grpc'; }],
    ['XUDP without UDP', value => { value.订阅转换配置.XUDP = true; value.订阅转换配置.UDP = false; }],
    ['gRPC with early data', value => { value.传输协议 = 'grpc'; value.启用0RTT = true; }],
    ['Shadowsocks with early data', value => { value.协议类型 = 'ss'; value.启用0RTT = true; }],
    ['ECH without Shadowsocks TLS', value => { value.协议类型 = 'ss'; value.SS.TLS = false; value.ECH = true; }],
    ['fragmentation without Shadowsocks TLS', value => { value.协议类型 = 'ss'; value.SS.TLS = false; value.TLS分片 = 'Happ'; }],
    ['missing external subscription source', value => { value.优选订阅生成.local = false; value.优选订阅生成.SUB = null; }],
    ['malformed converter URL', value => { value.订阅转换配置.SUBAPI = 'not-a-url'; }],
  ];
  for (const [name, mutate] of corruptions) {
    await t.test(name, async () => {
      const invalid = structuredClone(persisted);
      mutate(invalid);
      const response = await save(invalid);
      assert.equal(response.status, 400, await response.text());
      const reloaded = await read();
      assert.equal(reloaded.status, 200, 'An invalid write must not break subsequent reads');
      const data = await reloaded.json();
      assert.deepEqual(data.反代, persisted.反代);
      assert.deepEqual(data.优选订阅生成, persisted.优选订阅生成);
      assert.deepEqual(data.SS, persisted.SS);
      assert.deepEqual(data.订阅转换配置, persisted.订阅转换配置);
    });
  }
});
