// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Execute the actual UI controllers with controlled clocks/responses. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const usageSource = readFileSync(new URL('../public/assets/usage.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../public/assets/app.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const counts = (total = 55) => ({ success: true, workers: total, pages: 0, total, max: 100000 });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function panelHarness() {
  const response = deferred(), listeners = new Map(), metric = {}, detail = {}, writes = [];
  let now = Date.parse('2026-09-17T23:59:59Z');
  let config = { CF: { APIToken: '********', Usage: counts() } };
  const dispatch = (type, data) => listeners.get(type)?.({ detail: data });
  const context = vm.createContext({
    Intl, AbortController, setTimeout, clearTimeout, setInterval() {},
    Date: class extends Date { static now() { return now; } },
    document: { hidden: false, addEventListener() {}, getElementById: id => id === 'metric-usage' ? metric : id === 'metric-usage-detail' ? detail : null },
    addEventListener: (type, listener) => listeners.set(type, listener),
    BrclioUI: {
      getConfig: () => config,
      api: () => response.promise,
      setUsage(usage, sampledAt) { writes.push({ usage, sampledAt }); config.CF.Usage = usage; dispatch('brclio:usage', { sampledAt }); },
    },
  });
  vm.runInContext(usageSource, context);
  dispatch('brclio:config', { requestedAt: now });
  return { controller: context.BrclioUsage, response, writes, metric, detail, dispatch, setNow(value) { now = value; }, setCF(value) { config.CF = value; } };
}

test('a response that crosses UTC midnight remains labeled as the previous query day', async () => {
  const h = panelHarness();
  const pending = h.controller.refresh();
  h.setNow(Date.parse('2026-09-18T00:00:01Z'));
  h.response.resolve(counts(97)); await pending;
  assert.equal(h.writes[0].sampledAt, Date.parse('2026-09-17T23:59:59Z'));
  assert.equal(h.metric.textContent, '97');
  assert.equal(h.detail.textContent, '已跨日，请刷新用量');
});

test('a failed refresh keeps the previous count, and clearing credentials invalidates late responses', async () => {
  const failure = panelHarness();
  const failed = failure.controller.refresh();
  failure.response.reject(new Error('fixture unavailable')); await failed;
  assert.equal(failure.metric.textContent, '55'); assert.equal(failure.writes.length, 0);
  assert.match(failure.detail.textContent, /刷新失败/);
  const cleared = panelHarness();
  const pending = cleared.controller.refresh();
  cleared.setCF({ Usage: { success: false } }); cleared.controller.clear();
  cleared.response.resolve(counts(999)); await pending;
  assert.equal(cleared.writes.length, 0); assert.equal(cleared.metric.textContent, '未配置');
});

test('an older workspace response cannot cancel the new credentials usage refresh', async () => {
  const h = panelHarness();
  const pending = h.controller.refresh();
  h.dispatch('brclio:config', { requestedAt: Date.parse('2026-09-16T12:00:00Z'), preserveUsage: true });
  h.response.resolve(counts(72)); await pending;
  assert.equal(h.writes.length, 1); assert.equal(h.metric.textContent, '72');
});

function appHarness(functionNames) {
  const nodes = new Map(), events = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, disabled: false, textContent: '' }); return nodes.get(id); };
  const state = { config: { CF: { Usage: { success: false } }, TG: { 启用: false, BotToken: null, ChatID: null } }, baseline: '{}', rawDirty: false };
  const context = vm.createContext({
    state, cfRevision: 0, $, Date, Promise, JSON, clone: copy,
    renderFields() {}, renderOverview() {}, renderSubscriptionLinks() {}, renderIntegration() {}, updateSaveState() {}, syncCFMode() {}, toast() {}, navigate() {},
    loadAddresses: async () => {}, loadLogs: async () => {}, confirmAction: async () => true,
    window: { dispatchEvent: event => events.push(event), BrclioUsage: { clear() {} } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  function $(id) { return node(id); }
  for (const name of functionNames) {
    const start = appSource.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `Missing actual controller ${name}`);
    const rest = appSource.slice(start), boundary = rest.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(boundary < 0 ? rest : rest.slice(0, boundary + 1), context);
  }
  return { context, state, node, events };
}

test('applying an old JSON snapshot preserves live CF and Telegram credentials while keeping main edits', () => {
  const h = appHarness(['applyRaw', 'syncMetadataText']);
  h.state.config.CF = { Usage: { success: false } };
  h.state.config.TG = { 启用: false, BotToken: 'new-mask', ChatID: 'new-chat' };
  const edited = { PATH: '/unsaved-edit', 优选订阅生成: {}, 订阅转换配置: {}, 反代: {}, CF: { APIToken: 'old-mask', Usage: counts(999) }, TG: { 启用: true, BotToken: 'old-mask', ChatID: 'old-chat' } };
  h.node('raw-config').value = JSON.stringify(edited); h.state.rawDirty = true;
  h.context.syncMetadataText();
  assert.equal(h.node('raw-config').value, JSON.stringify(edited));
  assert.equal(h.context.applyRaw({ notify: false }), true);
  assert.deepEqual(copy(h.state.config.CF), { Usage: { success: false } });
  assert.equal(h.state.config.PATH, '/unsaved-edit');
  assert.deepEqual(copy(h.state.config.TG), { 启用: true, BotToken: 'new-mask', ChatID: 'new-chat' });
});

test('slow workspace hydration preserves credentials changed after the configuration request started', async () => {
  const h = appHarness(['loadWorkspace']), response = deferred();
  h.context.api = path => path === '/admin/config.json' ? response.promise : Promise.resolve({ version: 'test' });
  const pending = h.context.loadWorkspace();
  h.context.cfRevision++;
  const current = { APIToken: 'new-mask', Usage: counts(23) }; h.state.config.CF = copy(current);
  response.resolve({ CF: { APIToken: 'old-mask', Usage: counts(999) } }); await pending;
  assert.deepEqual(copy(h.state.config.CF), current);
  assert.deepEqual(JSON.parse(h.state.baseline).CF, current);
  assert.equal(h.events.at(-1).detail.preserveUsage, true);
});

test('clearing credentials locks the entire form until the save finishes', async () => {
  const h = appHarness(['clearIntegration', 'syncMetadataText']), response = deferred();
  const controls = [{ disabled: false }, { disabled: false }, { disabled: false }];
  h.node('cf-form').querySelectorAll = () => controls;
  h.context.api = () => response.promise;
  const pending = h.context.clearIntegration('cf'); await new Promise(resolve => setImmediate(resolve));
  assert.ok(controls.every(control => control.disabled));
  response.resolve({ success: true }); await pending;
  assert.ok(controls.every(control => !control.disabled));
  assert.equal(h.context.cfRevision, 1);
  assert.deepEqual(JSON.parse(h.state.baseline).CF, { Usage: { success: false } });
});
