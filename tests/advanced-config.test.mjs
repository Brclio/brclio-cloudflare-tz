// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://advanced.example.net';
const converted = [];
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: 'dist/_worker.js', compatibilityDate: '2026-09-01', cf: false,
  kvNamespaces: ['KV'],
  bindings: { ADMIN: 'advanced-config-test', UUID: '00000000-0000-4000-8000-000000000001', OFF_LOG: 'true' },
  outboundService: async request => {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://converter.example.net');
    converted.push(url);
    return new Response('proxies: []\n', { headers: { 'Content-Type': 'application/x-yaml' } });
  },
}));
after(() => mf.dispose());

test('advanced settings persist and reach generated links and the converter', async t => {
  const login = await mf.dispatchFetch(origin + '/login', {
    method: 'POST', headers: { Origin: origin, 'User-Agent': 'Advanced-QA' }, body: 'password=advanced-config-test',
  });
  assert.equal(login.status, 200);
  const headers = { Origin: origin, 'User-Agent': 'Advanced-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  const read = async () => (await mf.dispatchFetch(origin + '/admin/config.json', { headers })).json();
  const save = async config => {
    const response = await mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers, body: JSON.stringify(config) });
    assert.equal(response.status, 200, await response.text());
    return read();
  };
  const config = await read();
  const kv = await mf.getKVNamespace('KV');
  await kv.put('ADD.txt', 'edge.example.net:443#Advanced');
  config.优选订阅生成.本地IP库.随机IP = false;
  config.PATH = '/advanced';
  config.ALPN = 'h3,h2,http/1.1';
  config.Fingerprint = 'qq';
  config.TLS分片 = 'Happ';
  config.启用0RTT = true;
  config.ECH = true;
  config.ECHConfig = { DNS: 'https://dns.example.net/query', SNI: 'ech.example.net' };
  config.gRPCUserAgent = 'custom-grpc-agent';
  config.反代.PROXYIP = 'exit.example.net:443';
  config.反代.路径模板.PROXYIP = '?proxyip={{IP:PORT}}';

  for (const protocol of ['vless', 'trojan']) {
    await t.test(`${protocol} single link and subscription retain ALPN, fingerprint, ECH, fragmentation and path`, async () => {
      config.协议类型 = protocol;
      const saved = await save(config);
      assert.equal(saved.ALPN, config.ALPN);
      assert.deepEqual(saved.ECHConfig, config.ECHConfig);
      const response = await mf.dispatchFetch(origin + '/sub?target=mixed&b64=1&token=' + saved.优选订阅生成.TOKEN);
      assert.equal(response.status, 200);
      const subscription = Buffer.from(await response.text(), 'base64').toString('utf8').trim();
      for (const value of [saved.LINK, subscription]) {
        const link = new URL(value);
        assert.equal(link.protocol, protocol + ':');
        assert.equal(link.searchParams.get('alpn'), config.ALPN);
        assert.equal(link.searchParams.get('fp'), 'qq');
        assert.equal(link.searchParams.get('ech'), 'ech.example.net+https://dns.example.net/query');
        assert.equal(link.searchParams.get('fragment'), '3,1,tlshello');
        assert.equal(link.searchParams.get('path'), '/advanced?proxyip=exit.example.net:443&ed=2560');
      }
    });
  }
  await t.test('gRPC mode and every proxy template survive saves and affect serviceName', async () => {
    config.传输协议 = 'grpc'; config.gRPC模式 = 'multi'; config.启用0RTT = false;
    for (const protocol of ['SOCKS5', 'HTTP', 'HTTPS', 'TURN', 'SSTP']) {
      config.反代.路径模板[protocol] = { 标准: protocol.toLowerCase() + '={{IP:PORT}}', 全局: protocol.toLowerCase() + '://{{IP:PORT}}' };
    }
    config.反代.SOCKS5.启用 = 'socks5'; config.反代.SOCKS5.账号 = 'proxy.example.net:1080';
    config.反代.SOCKS5.全局 = true;
    const saved = await save(config);
    assert.deepEqual(saved.反代.路径模板, config.反代.路径模板);
    assert.equal(saved.gRPCUserAgent, 'custom-grpc-agent');
    const link = new URL(saved.LINK);
    assert.equal(link.searchParams.get('type'), 'grpc');
    assert.equal(link.searchParams.get('mode'), 'multi');
    assert.equal(link.searchParams.get('serviceName'), '/advanced/socks5://proxy.example.net:1080');
  });
  await t.test('all conversion switches are sent to the configured backend', async () => {
    config.传输协议 = 'ws'; config.ECH = false; config.跳过证书验证 = true;
    config.订阅转换配置.SUBAPI = 'https://converter.example.net';
    config.订阅转换配置.SUBCONFIG = 'https://rules.example.net/custom.ini';
    for (const key of ['SUBEMOJI', 'SUBLIST', 'UDP', 'XUDP', 'TLS13', 'APPEND_TYPE', 'SORT', 'EXPAND']) config.订阅转换配置[key] = true;
    const saved = await save(config);
    assert.deepEqual(saved.订阅转换配置, config.订阅转换配置);
    const response = await mf.dispatchFetch(origin + '/sub?target=clash&token=' + saved.优选订阅生成.TOKEN);
    assert.equal(response.status, 200);
    await response.text();
    const request = converted.at(-1);
    assert.ok(request);
    assert.equal(request.searchParams.get('config'), config.订阅转换配置.SUBCONFIG);
    for (const key of ['emoji', 'list', 'scv', 'udp', 'xudp', 'tls13', 'append_type', 'sort', 'expand']) assert.equal(request.searchParams.get(key), 'true', key);
  });
});
