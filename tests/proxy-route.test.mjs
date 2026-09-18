// Copyright (C) 2026 Brclio. GPL-2.0-only.
// The unchanged production bundle authenticates VLESS and forwards through an
// actual loopback HTTP CONNECT proxy. Only one direct echo fixture is allowed.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'https://route.example';
const uuid = '00000000-0000-4000-8000-000000000001';
const payload = Buffer.from('authenticated chain echo');
const sockets = new Set(), credentials = [], unexpectedFetches = [];
let mf, server, directServer, port, directPort, adminHeaders, config;
const wrapper = `
import worker from './dist/_worker.js';
import { connect } from 'cloudflare:sockets';
const dials = [];
export default { async fetch(request, env, ctx) {
  if (new URL(request.url).pathname === '/__state') return Response.json(dials);
  Object.defineProperty(request, 'fetcher', { value: { connect(options, init) {
    dials.push({ hostname: options.hostname, port: Number(options.port) });
    if (options.hostname === 'direct.fixture' && Number(options.port) === 443) return connect({ hostname: '127.0.0.1', port: Number(env.DIRECT_PORT) }, init);
    if (!['127.0.0.1', '[::1]'].includes(options.hostname) || Number(options.port) !== Number(env.PROXY_PORT)) throw Error('Direct dial forbidden by route fixture');
    return connect(options, init);
  } } });
  return worker.fetch(request, env, ctx);
} };
`;

before(async () => {
  server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    function handshake(chunk) {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      const text = pending.subarray(0, end).toString();
      const auth = /^Proxy-Authorization:\s*Basic ([^\r\n]+)$/im.exec(text)?.[1];
      const actual = auth ? Buffer.from(auth, 'base64').toString() : '';
      credentials.push(actual);
      if (!text.startsWith('CONNECT target.example:443 HTTP/1.1\r\n') || !['CaseUser:CasePassword', 'CaseUser:Case:Password'].includes(actual)) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      socket.removeListener('data', handshake);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      const extra = pending.subarray(end + 4);
      if (extra.length) socket.write(extra);
      socket.pipe(socket);
    }
    socket.on('data', handshake);
  });
  await new Promise(resolve => server.listen(0, '::', resolve));
  port = server.address().port;
  directServer = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.pipe(socket);
  });
  await new Promise(resolve => directServer.listen(0, '127.0.0.1', resolve));
  directPort = directServer.address().port;
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: root,
    modules: [
      { type: 'ESModule', path: `${root}/proxy-route-fixture.mjs`, contents: wrapper },
      { type: 'ESModule', path: `${root}/dist/_worker.js` },
    ],
    compatibilityDate: '2026-09-01', cf: false, kvNamespaces: ['KV'],
    bindings: { ADMIN: 'local-route-test-password', UUID: uuid, OFF_LOG: 'true', PROXY_PORT: String(port), DIRECT_PORT: String(directPort), TCP_CONCURRENT_DIAL: '1' },
    outboundService: request => { unexpectedFetches.push(request.url); return new Response('External fetch blocked', { status: 599 }); },
  }));
  const login = await mf.dispatchFetch(origin + '/login', {
    method: 'POST', headers: { Origin: origin, 'User-Agent': 'Route-QA' }, body: 'password=local-route-test-password',
  });
  assert.equal(login.status, 200);
  adminHeaders = { Origin: origin, 'User-Agent': 'Route-QA', Cookie: login.headers.get('Set-Cookie').split(';')[0], 'Content-Type': 'application/json' };
  config = await (await mf.dispatchFetch(origin + '/admin/config.json', { headers: adminHeaders })).json();
  config.优选订阅生成.本地IP库.随机IP = false;
  config.反代.SOCKS5.白名单 = ['target.example'];
  await (await mf.getKVNamespace('KV')).put('ADD.txt', '198.51.100.1:443#Local');
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await mf?.dispose();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (directServer?.listening) await new Promise(resolve => directServer.close(resolve));
  assert.deepEqual(unexpectedFetches, []);
});

function deadline(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Route fixture timed out')), 4000); })])
    .finally(() => clearTimeout(timer));
}

function vless(target = 'target.example') {
  const hostname = Buffer.from(target);
  return Buffer.concat([Buffer.from([0]), Buffer.from(uuid.replaceAll('-', ''), 'hex'), Buffer.from([0, 1, 1, 187, 2, hostname.length]), hostname, payload]);
}

function encodedRoute(overrides = {}) {
  const json = Buffer.from(JSON.stringify({ type: 'http', username: 'CaseUser', password: 'CasePassword', hostname: '127.0.0.1', port, ...overrides }));
  const key = Buffer.from(uuid);
  return Buffer.from(json.map((byte, index) => byte ^ key[index % key.length])).toString('base64');
}

function decodedRoute(path) {
  const encoded = path.slice(path.indexOf('/video/') + 7);
  const key = Buffer.from(uuid);
  return JSON.parse(Buffer.from(Buffer.from(encoded, 'base64').map((byte, index) => byte ^ key[index % key.length])).toString());
}

async function dials() { return (await mf.dispatchFetch(origin + '/__state')).json(); }

async function echoWS(path) {
  const response = await mf.dispatchFetch(origin + path, { headers: { Upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  const ws = response.webSocket;
  ws.accept();
  try {
    const echoed = await deadline(new Promise((resolve, reject) => {
      let pending = Buffer.alloc(0);
      ws.addEventListener('message', event => {
        pending = Buffer.concat([pending, Buffer.from(event.data)]);
        if (pending.length >= payload.length + 2) resolve(pending);
      });
      ws.addEventListener('error', () => reject(Error('WebSocket failed')), { once: true });
      ws.send(vless());
    }));
    assert.deepEqual(echoed, Buffer.concat([Buffer.from([0, 0]), payload]));
  } finally { try { ws.close(); } catch {} }
}

async function echoGRPC(path, target) {
  const initial = vless(target);
  assert.ok(initial.length < 128);
  const frame = Buffer.alloc(7);
  frame.writeUInt32BE(initial.length + 2, 1); frame[5] = 10; frame[6] = initial.length;
  let upload;
  const body = new ReadableStream({ start(controller) { upload = controller; controller.enqueue(Buffer.concat([frame, initial])); } });
  const response = await mf.dispatchFetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/grpc' }, body, duplex: 'half' });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  try {
    const echoed = await deadline((async () => {
      let wire = Buffer.alloc(0), plain = Buffer.alloc(0);
      while (plain.length < payload.length + 2) {
        const { value, done } = await reader.read(); assert.equal(done, false);
        wire = Buffer.concat([wire, Buffer.from(value)]);
        while (wire.length >= 5 && wire.length >= wire.readUInt32BE(1) + 5) {
          const end = wire.readUInt32BE(1) + 5;
          assert.equal(wire[0], 0); assert.equal(wire[5], 10); assert.equal(wire[6], end - 7);
          plain = Buffer.concat([plain, wire.subarray(7, end)]); wire = wire.subarray(end);
        }
      }
      return plain;
    })());
    assert.deepEqual(echoed, Buffer.concat([Buffer.from([0, 0]), payload]));
  } finally { try { upload.close(); } catch {} await reader.cancel().catch(() => {}); }
}

for (const alias of ['proxyip', 'PrOxYiP', 'pyip', 'IP']) {
  test(`${alias}=HTTP URI preserves case-sensitive credentials and uses the configured proxy`, { timeout: 10000 }, async () => {
    const before = (await dials()).length, authBefore = credentials.length;
    await echoWS(`/${alias}=http://CaseUser:CasePassword@127.0.0.1:${port}`);
    assert.deepEqual((await dials()).slice(before), [{ hostname: '127.0.0.1', port }]);
    assert.deepEqual(credentials.slice(authBefore), ['CaseUser:CasePassword']);
  });
}

for (const [transport, suffix] of [['ws', ''], ['ws', '/'], ['grpc', '/Tun'], ['grpc', '/TunMulti'], ['grpc', '/Tun/']]) {
  test(`encoded chain route retains its proxy for ${transport} suffix ${JSON.stringify(suffix)}`, { timeout: 10000 }, async () => {
    const before = (await dials()).length;
    await (transport === 'ws' ? echoWS : echoGRPC)('/video/' + encodedRoute() + suffix);
    assert.deepEqual((await dials()).slice(before), [{ hostname: '127.0.0.1', port }]);
  });
}

for (const [label, path] of [
  ['invalid global credentials', '/?http=BrokenAuth@127.0.0.1:1080&globalproxy'],
  ['empty global query', '/?socks5=&globalproxy'],
  ['empty proxyip URI', '/?proxyip=socks5://'],
  ['empty path proxyip URI', '/proxyip=http://'],
  ['empty path chain URI', '/socks5://'],
  ['empty path chain alias', '/gs5='],
  ['invalid encoded chain', '/video/invalid-encoded-secret/Tun'],
  ['empty encoded chain', '/video/'],
  ['invalid port', '/?http=user:pass@127.0.0.1:abc&globalproxy'],
  ['out-of-range port', '/?http=user:pass@127.0.0.1:99999&globalproxy'],
  ['mixed-digit port', '/?http=user:pass@127.0.0.1:44x3&globalproxy'],
  ['IPv6 mixed-digit port', '/?http=user:pass@[::1]:44x3&globalproxy'],
  ['empty trojan route', '/trojan='],
  ['invalid trojan route', '/trojan=broken'],
  ['prototype type', () => '/video/' + encodedRoute({ type: 'constructor' })],
  ['prototype magic type', () => '/video/' + encodedRoute({ type: '__proto__' })],
  ['string global flag', () => '/video/' + encodedRoute({ global: 'false' })],
  ['malformed percent route', '/%ZZ?http=CaseUser:CasePassword@127.0.0.1:1080'],
]) {
  test(`explicit ${label} is rejected with a safe 400 before any dial`, async () => {
    for (const transport of ['ws', 'grpc', 'xhttp']) {
      const before = (await dials()).length;
      const options = transport === 'ws' ? { headers: { Upgrade: 'websocket' } }
        : { method: 'POST', headers: { 'Content-Type': transport === 'grpc' ? 'application/grpc' : 'application/octet-stream' }, body: vless() };
      const response = await mf.dispatchFetch(origin + (typeof path === 'function' ? path() : path), options);
      assert.equal(response.status, 400, transport);
      assert.equal(await response.text(), 'Invalid proxy route', 'Errors must not reflect proxy credentials or route values');
      assert.equal((await dials()).length, before);
    }
  });
}

test('proxy authentication retains every colon after the username separator', async () => {
  const before = credentials.length;
  await echoWS(`/proxyip=http://CaseUser:Case:Password@127.0.0.1:${port}`);
  assert.deepEqual(credentials.slice(before), ['CaseUser:Case:Password']);
});

test('mixed directives keep the selected type and address together', async () => {
  for (const path of [
    `/proxyip=http://CaseUser:CasePassword@127.0.0.1:${port}?socks5=ignored:ignored@unused.example:1080`,
    `/?proxyip=http://CaseUser:CasePassword@127.0.0.1:${port}&socks5=ignored:ignored@unused.example:1080`,
    `/http://CaseUser:CasePassword@127.0.0.1:${port}?https=ignored:ignored@unused.example:443`,
  ]) {
    const before = (await dials()).length;
    await echoWS(path);
    assert.deepEqual((await dials()).slice(before), [{ hostname: '127.0.0.1', port }]);
  }
});

async function saveRoute(path, { random = false, early = false } = {}) {
  config.PATH = path;
  config.传输协议 = 'grpc';
  config.随机路径 = random;
  config.启用0RTT = early;
  config.反代.SOCKS5.启用 = null;
  config.反代.proxyip = 'auto';
  const saved = await mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers: adminHeaders, body: JSON.stringify(config) });
  assert.equal(saved.status, 200, await saved.text());
}

async function mixedResponse() {
  return mf.dispatchFetch(origin + '/sub?b64&token=' + config.优选订阅生成.TOKEN);
}

async function serviceName() {
  const response = await mixedResponse();
  assert.equal(response.status, 200);
  const links = Buffer.from(await response.text(), 'base64').toString().trim().split('\n');
  assert.equal(links.length, 1);
  return new URL(links[0]).searchParams.get('serviceName');
}

test('generated gRPC query routes retain credentials, precedence, random prefixes and RPC methods', { timeout: 20000 }, async () => {
  for (const [path, options, suffix] of [
    [`/?http=CaseUser:Case:Password@127.0.0.1:${port}&globalproxy`, {}, '/Tun'],
    [`/?proxyip=http://CaseUser:CasePassword@127.0.0.1:${port}&socks5=ignored:ignored@unused.example:1080&ed=2560`, { random: true }, '/TunMulti'],
    [`/proxyip=http://CaseUser:CasePassword@127.0.0.1:${port}?https=ignored:ignored@unused.example:443&ed=2560`, {}, '/Tun/'],
    [`/video/${encodedRoute()}?http=ignored:ignored@unused.example:80`, { random: true }, '/Tun'],
  ]) {
    await saveRoute(path, options);
    const service = await serviceName();
    const route = decodedRoute(service);
    assert.equal(route.type, 'http');
    assert.equal(route.hostname, '127.0.0.1');
    assert.equal(route.port, port);
    assert.equal(route.global, true);
    assert.equal(service.includes('?'), false);
    if (options.random) assert.equal(service.startsWith('/video/'), false);
    const before = (await dials()).length;
    await echoGRPC(service + suffix);
    assert.deepEqual((await dials()).slice(before), [{ hostname: '127.0.0.1', port }]);
  }
});

test('generated standard gRPC query route keeps whitelist mode instead of becoming global', async () => {
  await saveRoute(`/?http=CaseUser:CasePassword@127.0.0.1:${port}`);
  const service = await serviceName();
  assert.equal(decodedRoute(service).global, false);
  const before = (await dials()).length;
  await echoGRPC(service + '/Tun');
  assert.deepEqual((await dials()).slice(before), [{ hostname: '127.0.0.1', port }]);
  const beforeDirect = (await dials()).length, beforeAuth = credentials.length;
  await echoGRPC(service + '/Tun', 'direct.fixture');
  assert.deepEqual((await dials()).slice(beforeDirect), [{ hostname: 'direct.fixture', port: 443 }]);
  assert.equal(credentials.length, beforeAuth);
});

test('gRPC query templates preserve IPv6 proxy hosts and colon passwords through real CONNECT', async () => {
  await saveRoute('/prefix');
  config.反代.SOCKS5.启用 = 'http';
  config.反代.SOCKS5.全局 = true;
  config.反代.SOCKS5.账号 = `CaseUser:Case:Password@[::1]:${port}`;
  // Use the template placeholder from the saved default, without hardcoding
  // implementation internals or translating it into a different route form.
  const original = config.反代.路径模板.HTTP.标准;
  config.反代.路径模板.HTTP.全局 = '?http=' + original.slice(original.indexOf('=') + 1) + '&globalproxy';
  const saved = await mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers: adminHeaders, body: JSON.stringify(config) });
  assert.equal(saved.status, 200, await saved.text());
  const service = await serviceName();
  const route = decodedRoute(service);
  assert.equal(route.hostname, '[::1]');
  assert.equal(route.password, 'Case:Password');
  const before = (await dials()).length;
  await echoGRPC(service + '/TunMulti');
  assert.deepEqual((await dials()).slice(before), [{ hostname: '[::1]', port }]);
});

test('gRPC ordinary queries remain ignored and explicit bare ProxyIP queries become service paths', async () => {
  await saveRoute('/ordinary?ed=2560&tracking=test');
  assert.equal(await serviceName(), '/ordinary');
  await saveRoute('/ordinary?proxyip=[2001:db8::1]:8443&tracking=test');
  assert.equal(decodeURIComponent(await serviceName()), '/proxyip=[2001:db8::1]:8443');
});

test('malformed old KV gRPC routes return safe subscription errors and remain editable', async () => {
  await saveRoute('/?http=BrokenAuth@127.0.0.1:1080&globalproxy');
  const response = await mf.dispatchFetch(origin + '/admin/config.json', { headers: adminHeaders });
  assert.equal(response.status, 200);
  const loaded = await response.json();
  assert.equal(loaded.LINK, '');
  assert.equal(loaded.routeError.code, 'INVALID_PROXY_ROUTE');
  assert.equal(JSON.stringify(loaded.routeError).includes('BrokenAuth'), false);
  const before = (await dials()).length;
  const sub = await mixedResponse();
  assert.equal(sub.status, 400);
  assert.equal(await sub.text(), 'Invalid proxy route');
  assert.equal((await dials()).length, before);
  const fixed = { ...loaded, PATH: `/?http=CaseUser:CasePassword@127.0.0.1:${port}&globalproxy` };
  const saved = await mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers: adminHeaders, body: JSON.stringify(fixed) });
  assert.equal(saved.status, 200, await saved.text());
  const stored = JSON.parse(await (await mf.getKVNamespace('KV')).get('config.json'));
  assert.equal(Object.hasOwn(stored, 'routeError'), false);
  const repaired = await (await mf.dispatchFetch(origin + '/admin/config.json', { headers: adminHeaders })).json();
  assert.equal(Object.hasOwn(repaired, 'routeError'), false);
  assert.ok(repaired.LINK);
  await echoGRPC((await serviceName()) + '/Tun');
});

test('malformed legacy gRPC percent escapes and URL shapes remain editable with safe subscription errors', async () => {
  for (const path of ['/%ZZ?http=proxy.fixture:8080', '//[bad?http=proxy.fixture:8080']) {
    const kv = await mf.getKVNamespace('KV');
    const legacy = JSON.parse(await kv.get('config.json'));
    legacy.PATH = path;
    await kv.put('config.json', JSON.stringify(legacy));
    const response = await mf.dispatchFetch(origin + '/admin/config.json', { headers: adminHeaders });
    assert.equal(response.status, 200);
    const loaded = await response.json();
    assert.equal(loaded.LINK, '');
    assert.equal(loaded.routeError.code, 'INVALID_PROXY_ROUTE');
    const before = (await dials()).length;
    const sub = await mixedResponse();
    assert.equal(sub.status, 400);
    assert.equal(await sub.text(), 'Invalid proxy route');
    assert.equal((await dials()).length, before);
    loaded.PATH = '/repaired?ed=2560';
    const saved = await mf.dispatchFetch(origin + '/admin/config.json', { method: 'POST', headers: adminHeaders, body: JSON.stringify(loaded) });
    assert.equal(saved.status, 200, await saved.text());
    assert.equal(await serviceName(), '/repaired');
  }
});

test('a valid chain remark produces a gRPC subscription that reaches its authenticated proxy', async () => {
  await saveRoute('/remark', { random: true });
  await (await mf.getKVNamespace('KV')).put('ADD.txt', `198.51.100.1:443#Local$HTTP://CaseUser:Case:Password@127.0.0.1:${port}`);
  const service = await serviceName();
  const route = decodedRoute(service);
  assert.equal(route.type, 'http');
  assert.equal(route.password, 'Case:Password');
  const before = (await dials()).length, authBefore = credentials.length;
  await echoGRPC(service + '/TunMulti');
  assert.deepEqual((await dials()).slice(before), [{ hostname: '127.0.0.1', port }]);
  assert.deepEqual(credentials.slice(authBefore), ['CaseUser:Case:Password']);
});
