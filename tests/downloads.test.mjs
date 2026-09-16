// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Download tests execute the built program and then execute its downloaded
// program again. No source-template helper is imported or mocked.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unzipSync } from 'fflate';

const origin = 'https://downloads.example.com';
const userAgent = 'Brclio-Download-QA';
const endpoints = ['/admin/download/worker.js', '/admin/download/pages.zip'];
const sentinel = `runtime-private-${randomUUID()}`;
const bindings = {
  ADMIN: `${sentinel}-admin`,
  KEY: `${sentinel}-key`,
  UUID: randomUUID(),
  OFF_LOG: 'true',
  PROXYIP: '127.0.0.1:1',
  DOWNLOAD_TEST_SECRET: `${sentinel}-other-environment`,
};
let mf;
let builtSource;
let licenseFiles;

function instance(source, environment = bindings) {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: Buffer.from(source).toString('utf8'),
    compatibilityDate: '2026-09-01',
    cf: { colo: 'TEST', asn: 0, country: 'XX', city: 'Local test' },
    kvNamespaces: ['KV'],
    bindings: environment,
  }));
}

before(async () => {
  // Snapshot the exact file under test so an unrelated preview rebuild cannot
  // change our expected output while this workerd instance is running.
  builtSource = await readFile(new URL('../dist/_worker.js', import.meta.url));
  licenseFiles = Object.fromEntries(await Promise.all([
    ['LICENSE', '../LICENSE'],
    ['THIRD_PARTY_NOTICES.txt', '../THIRD_PARTY_NOTICES.md'],
    ['NotoSerifSC-OFL.txt', '../licenses/NotoSerifSC-OFL.txt'],
    ['qrcode-generator-MIT.txt', '../licenses/qrcode-generator-MIT.txt'],
    ['fflate-MIT.txt', '../licenses/fflate-MIT.txt'],
  ].map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url))])));
  mf = instance(builtSource);
  await mf.ready;
});
after(async () => { if (mf) await mf.dispose(); });

function request(runtime, path, { cookie, method = 'GET', body } = {}) {
  return runtime.dispatchFetch(origin + path, {
    method, body, redirect: 'manual',
    headers: { 'User-Agent': userAgent, Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
  });
}

async function signIn(runtime = mf, password = bindings.ADMIN) {
  const response = await request(runtime, '/login', { method: 'POST', body: new URLSearchParams({ password }).toString() });
  assert.equal(response.status, 200, 'Downloaded program must authenticate with its runtime ADMIN');
  assert.equal((await response.json()).success, true);
  const cookie = response.headers.get('Set-Cookie');
  assert.ok(cookie);
  return cookie.split(';')[0];
}

function assertExact(actual, expected, label) {
  actual = Buffer.from(actual);
  expected = Buffer.from(expected);
  assert.equal(actual.length, expected.length, `${label}: byte count`);
  assert.ok(actual.equals(expected), `${label}: byte-for-byte mismatch (${createHash('sha256').update(actual).digest('hex')} vs ${createHash('sha256').update(expected).digest('hex')})`);
}

async function download(runtime, path, cookie) {
  const response = await request(runtime, path, { cookie });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('Content-Disposition') || '', /^attachment; filename=".+"$/);
  assert.match(response.headers.get('Content-Type') || '', path.endsWith('.zip') ? /application\/zip/ : /(?:text|application)\/javascript/);
  return Buffer.from(await response.arrayBuffer());
}

function unpackPages(bytes) {
  const files = unzipSync(bytes);
  assert.ok(files['_worker.js'], 'ZIP has a root _worker.js entry');
  assertExact(files['_worker.js'], builtSource, 'ZIP Worker source');
  assert.deepEqual(JSON.parse(Buffer.from(files['_routes.json']).toString()), { version: 1, include: ['/*'], exclude: [] });
  assert.match(Buffer.from(files['index.html']).toString(), /<!doctype html>/i);
  for (const [name, expected] of Object.entries(licenseFiles)) {
    const entry = files[name] || (name === 'LICENSE' ? files['LICENSE.txt'] : undefined);
    assert.ok(entry, `ZIP includes ${name}`);
    assertExact(entry, expected, `ZIP ${name}`);
  }
  for (const name of Object.keys(files)) {
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), 'ZIP entries have safe relative paths');
  }
  return files;
}

test('both deployment downloads require a current authenticated management session', async t => {
  const valid = await signIn();
  const tampered = valid.replace(/.$/, char => char === 'a' ? 'b' : 'a');
  const expires = Math.floor(Date.now() / 1000) - 1;
  const nonce = '1'.repeat(32);
  const signature = createHmac('sha256', `${bindings.KEY}\u0000${bindings.ADMIN}`).update(`${expires}.${nonce}.${userAgent}`).digest('hex');
  const expired = `auth=${expires}.${nonce}.${signature}`;
  const revoked = await signIn();
  assert.equal((await request(mf, '/logout', { cookie: revoked })).status, 302);
  for (const [caseName, cookie] of [['anonymous', undefined], ['tampered', tampered], ['expired', expired], ['logged out', revoked]]) {
    for (const path of endpoints) {
      await t.test(`${caseName}: ${path}`, async () => {
        const response = await request(mf, path, { cookie });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('Content-Disposition'), null);
        assert.ok((await response.json()).error);
      });
    }
  }
});

test('authenticated Worker download is byte-for-byte the built standalone program', async () => {
  const cookie = await signIn();
  const downloaded = await download(mf, endpoints[0], cookie);
  assertExact(downloaded, builtSource, 'Authenticated Worker download');
});

test('authenticated Pages ZIP unpacks to the identical standalone Worker and complete license files', async () => {
  const cookie = await signIn();
  unpackPages(await download(mf, endpoints[1], cookie));
});

test('the release Pages ZIP contains only deployment files and complete matching licenses', async () => {
  const files = unpackPages(await readFile(new URL('../dist/brclio-edge-pages.zip', import.meta.url)));
  assert.deepEqual(Object.keys(files).sort(), [
    '_worker.js', '_routes.json', 'index.html', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt',
    'NotoSerifSC-OFL.txt', 'qrcode-generator-MIT.txt', 'fflate-MIT.txt',
  ].sort());
});

test('the standalone Worker serves every bundled license byte-for-byte', async () => {
  for (const [name, expected] of Object.entries(licenseFiles)) {
    const assetName = name === 'THIRD_PARTY_NOTICES.txt' ? 'THIRD_PARTY_NOTICES.md' : name;
    const response = await request(mf, '/assets/licenses/' + assetName);
    assert.equal(response.status, 200, assetName);
    assertExact(await response.arrayBuffer(), expected, `Worker license ${assetName}`);
  }
  assertExact(licenseFiles['fflate-MIT.txt'], await readFile(new URL('../node_modules/fflate/LICENSE', import.meta.url)), 'Locked fflate package license');
});

test('downloaded programs restart in real workerd and reproduce the same source and Pages package', { timeout: 30000 }, async t => {
  const cookie = await signIn();
  const workerDownload = await download(mf, endpoints[0], cookie);
  const pagesDownload = unpackPages(await download(mf, endpoints[1], cookie))['_worker.js'];
  for (const [name, source] of [['Worker download', workerDownload], ['Pages ZIP Worker', pagesDownload]]) {
    await t.test(name, async () => {
      const nextBindings = { ...bindings, ADMIN: `${sentinel}-second-admin`, KEY: `${sentinel}-second-key`, UUID: randomUUID() };
      const restarted = instance(source, nextBindings);
      try {
        const nextCookie = await signIn(restarted, nextBindings.ADMIN);
        const sameSource = await download(restarted, endpoints[0], nextCookie);
        assertExact(sameSource, builtSource, `${name} reproduces exact original source without recursive growth`);
        unpackPages(await download(restarted, endpoints[1], nextCookie));
        for (const path of ['/admin', '/assets/app.js', '/assets/app.css', '/assets/login.js']) {
          const page = await request(restarted, path, { cookie: nextCookie });
          assert.equal(page.status, 200, `${name} still serves ${path}`);
          assert.ok((await page.arrayBuffer()).byteLength > 0);
        }
        assert.equal((await request(restarted, endpoints[0], { cookie })).status, 401, 'New runtime ADMIN/KEY invalidates the original runtime session');
      } finally {
        await restarted.dispose();
      }
    });
  }
});

test('downloads never serialize runtime environment values or private KV credentials', async () => {
  const cookie = await signIn();
  const kv = await mf.getKVNamespace('KV');
  const cfToken = `${sentinel}-cloudflare-token`;
  const tgToken = `${sentinel}-telegram-token`;
  await kv.put('cf.json', JSON.stringify({ APIToken: cfToken }));
  await kv.put('tg.json', JSON.stringify({ BotToken: tgToken }));
  // Initialize runtime configuration first, rather than checking only a cold
  // program which has not yet read its environment or credential bindings.
  const config = await request(mf, '/admin/config.json', { cookie });
  assert.equal(config.status, 200);
  assert.equal((await config.json()).UUID, bindings.UUID);
  const source = await download(mf, endpoints[0], cookie);
  assertExact(source, builtSource, 'Warm Worker with runtime secrets');
  const files = unpackPages(await download(mf, endpoints[1], cookie));
  const privateValues = [bindings.ADMIN, bindings.KEY, bindings.UUID, bindings.DOWNLOAD_TEST_SECRET, cfToken, tgToken];
  for (const [name, content] of [['worker.js', source], ...Object.entries(files)]) {
    const text = Buffer.from(content).toString('utf8');
    for (const secret of privateValues) {
      assert.ok(!text.includes(secret), `${name} must omit runtime private values`);
      assert.ok(!text.includes(Buffer.from(secret).toString('base64')), `${name} must omit base64 runtime private values`);
    }
  }
});

test('an unconfigured Worker serves setup guidance instead of deployment downloads', async () => {
  const bare = instance(builtSource, { OFF_LOG: 'true' });
  try {
    for (const path of endpoints) {
      const response = await request(bare, path);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Content-Disposition'), null);
      assert.match(await response.text(), /ADMIN/);
    }
  } finally {
    await bare.dispose();
  }
});
