import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchClashHealthChecks as patch } from '../src/subscription-health.js';

test('only known 204 health groups gain an expected status; select groups and proxy properties survive', () => {
  const before = `proxies:
  - name: node
    type: vless
    url: http://www.gstatic.com/generate_204
    ws-opts: {path: '/credential?token=keep&ed=2560'}
proxy-groups:
  - name: auto
    type: url-test
    url: http://www.gstatic.com/generate_204
    proxies: [node]
    interval: 300
    tolerance: 50
  - name: fallback
    type: fallback
    url: https://www.google.com/generate_204
    proxies: [node]
  - name: balance
    type: load-balance
    url: https://cp.cloudflare.com/generate_204
    strategy: consistent-hashing
    proxies: [node]
  - name: manual
    type: select
    url: http://www.gstatic.com/generate_204
    proxies: [auto, node]
rules:
  - MATCH,manual
`;
  const after = patch(before);
  assert.equal(after.match(/expected-status: 204/g)?.length, 3);
  assert.equal(after.replace(/^    expected-status: 204\n/gm, ''), before);
  assert.equal(patch(after), after, 'The patch is idempotent');
});

test('custom endpoints, URL query/fragment/userinfo and explicit status choices are preserved', () => {
  for (const url of ['https://custom.example/health', 'https://www.gstatic.com/generate_204?token=keep',
    'https://www.gstatic.com/generate_204#custom', 'https://user:pass@www.gstatic.com/generate_204',
    'https://www.gstatic.com:443/generate_204', 'https://www.gstatic.com/generate_204/']) {
    const yaml = `proxy-groups:\n- name: auto\n  type: url-test\n  url: '${url}'\n  proxies: [node]\n`;
    assert.equal(patch(yaml), yaml);
  }
  for (const status of ['204', '200/302', '"*"', "'*'", '200-399 # custom']) {
    const yaml = `proxy-groups:\n- name: auto\n  type: url-test\n  url: http://www.gstatic.com/generate_204\n  expected-status: ${status}\n`;
    assert.equal(patch(yaml), yaml);
  }
});

test('inline mappings preserve nested arrays, quoted commas, credentials and trailing comments', () => {
  const yaml = `proxies:\n- {name: node, type: vless, ws-opts: {path: '/secret?token=keep'}}\nproxy-groups:\n- {name: "auto, {one}", type: 'url-test', proxies: [node, "quoted, node"], url: "https://www.gstatic.com/generate_204", interval: 300} # keep\n`;
  const after = patch(yaml);
  assert.equal(after, yaml.replace('interval: 300}', 'interval: 300, expected-status: 204}'));
  assert.equal(patch(after), after);
});

test('multiline flow mappings and a trailing comma remain valid without rewriting values', () => {
  const yaml = `proxy-groups:\n  - {name: auto, type: url-test,\n     proxies: [node], url: 'http://www.google.com/generate_204', }\n`;
  assert.equal(patch(yaml), yaml.replace("generate_204', }", "generate_204', expected-status: 204, }"));
});

test('quoted keys/statuses and single quoted YAML escaping preserve explicit user semantics', () => {
  const explicit = `proxy-groups:\n- {name: 'user''s auto', type: url-test, url: http://www.gstatic.com/generate_204, "expected-status": '*'}\n`;
  assert.equal(patch(explicit), explicit);
  const yaml = `proxy-groups:\n- name: 'user''s auto'\n  type: "fallback"\n  url: 'http://www.gstatic.com/generate_204' # health\n  proxies: [node]\n`;
  assert.equal(patch(yaml), yaml.replace(' # health\n', ' # health\n  expected-status: 204\n'));
});

test('ambiguous, inherited, tagged or malformed YAML is left unchanged', () => {
  for (const yaml of [
    `proxy-groups: [{name: auto, type: url-test, url: http://www.gstatic.com/generate_204}]\n`,
    `proxy-groups:\n- &auto\n  type: url-test\n  url: http://www.gstatic.com/generate_204\n`,
    `proxy-groups:\n- name: auto\n  <<: *defaults\n  type: url-test\n  url: http://www.gstatic.com/generate_204\n`,
    `proxy-groups:\n- name: auto\n  type: !!str url-test\n  url: http://www.gstatic.com/generate_204\n`,
    `proxy-groups:\n- {name: auto, type: url-test, type: fallback, url: http://www.gstatic.com/generate_204}\n`,
    `proxy-groups:\n- {name: auto, type: url-test, url: "http://www.gstatic.com/generate_204}\n`,
    `proxy-groups:\n- {name: auto, type: url-test, # preserve unknown flow comments\n  url: http://www.gstatic.com/generate_204}\n`,
  ]) assert.equal(patch(yaml), yaml);
});

test('CRLF, surrounding sections, comments and absent groups are retained', () => {
  const yaml = '# header\r\nproxy-groups:\r\n- name: auto\r\n  type: fallback\r\n  url: http://cp.cloudflare.com/generate_204\r\nrules:\r\n- MATCH,auto\r\n';
  assert.equal(patch(yaml), yaml.replace('generate_204\r\n', 'generate_204\r\n  expected-status: 204\r\n'));
  assert.equal(patch('proxies: []\n'), 'proxies: []\n');
  assert.equal(patch(null), null);
});

test('block groups accept indentless child proxy lists without mistaking children for fields', () => {
  const yaml = `proxy-groups:\n- name: auto\n  proxies:\n  - node\n  - 'node: two'\n  type: url-test\n  url: https://www.gstatic.com/generate_204\n`;
  assert.equal(patch(yaml), yaml + '  expected-status: 204\n');
});

test('the production Clash patch enforces health status before its ECH/gRPC early return', async () => {
  const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  const start = source.indexOf('function Clash订阅配置文件热补丁(');
  const end = source.indexOf('\nasync function Singbox订阅配置文件热补丁(', start);
  assert.ok(start >= 0 && end > start, 'Locate the production subscription function');
  const productionPatch = new Function('patchClashHealthChecks',
    source.slice(start, end) + '\nreturn Clash订阅配置文件热补丁;')(patch);
  const yaml = `mode: Rule
dns:
  enable: true
proxies:
- {name: node, type: vless, ws-opts: {path: '/keep?token=fixture&ed=2560'}}
proxy-groups:
- name: auto
  type: url-test
  url: http://www.gstatic.com/generate_204
  proxies: [node]
rules:
- MATCH,auto
`;
  const expected = yaml.replace('mode: Rule', 'mode: rule')
    .replace('generate_204\n', 'generate_204\n  expected-status: 204\n');
  for (const config of [{}, { ECH: false, 传输协议: 'ws', gRPCUserAgent: '' }]) {
    assert.equal(productionPatch(yaml, config), expected);
    assert.equal(productionPatch(expected, config), expected, 'Production integration stays idempotent');
  }
});
