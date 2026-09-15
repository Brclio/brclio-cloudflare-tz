/* SPDX-License-Identifier: GPL-2.0-only · Original Brclio Edge interface */
'use strict';

const $ = (id) => document.getElementById(id);
const state = { config: null, baseline: '', meta: null, logs: [], logsLoaded: false, logPage: 0, addressesBaseline: '', addressesLoaded: false, rawDirty: false, cfDirty: false, tgDirty: false, busy: false, page: 'overview' };
const pageNames = { overview: '概览', nodes: '节点配置', subscriptions: '订阅管理', speedtest: '测速与优选', routing: '路由与代理', logs: '访问日志', settings: '设置' };
const bindings = [];
const PAGE_SIZE = 25;
let fieldSequence = 0;

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function read(path) { return path.reduce((value, key) => value?.[key], state.config); }
function write(path, value) {
  let cursor = state.config;
  path.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[path.at(-1)] = value;
}
function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  node.append(use);
  node.setAttribute('aria-hidden', 'true');
  return node;
}
function toast(message, error = false) {
  const notice = el('div', 'toast' + (error ? ' error' : ''));
  notice.append(el('span', '', message));
  const close = el('button', '', '×');
  close.type = 'button'; close.setAttribute('aria-label', '关闭提示');
  close.addEventListener('click', () => notice.remove());
  notice.append(close); $('toast-stack').append(notice);
  setTimeout(() => notice.remove(), error ? 10000 : 5500);
}
async function confirmAction(title, message, label = '确认', dangerous = false) {
  const dialog = $('confirm-dialog');
  if (dialog.open) return false;
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-accept').textContent = label;
  $('confirm-accept').className = 'button ' + (dangerous ? 'button-danger' : 'button-primary');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function api(path, { method = 'GET', data, text = false, signal } = {}) {
  const requestSignal = signal || (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined);
  const options = { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: text ? 'text/plain' : 'application/json' }, signal: requestSignal };
  if (data !== undefined) {
    options.headers['Content-Type'] = typeof data === 'string' ? 'text/plain;charset=UTF-8' : 'application/json';
    options.body = typeof data === 'string' ? data : JSON.stringify(data);
  }
  let response;
  try { response = await fetch(path, options); }
  catch (error) { throw new Error(error.name === 'TimeoutError' ? '请求超过 20 秒，请检查网络或稍后重试。' : error.name === 'AbortError' ? '请求已取消，请重试。' : '网络连接失败，请检查网络后重试。'); }
  if (response.status === 401) {
    toast('登录已过期，请重新登录。未保存的内容不会提交。', true);
    state.busy = false; updateSaveState();
    const login = el('a', 'button button-small', '重新登录');
    login.href = '/login';
    const panel = $('global-error');
    $('global-error-text').textContent = '会话已过期。请先在新标签页登录，再回到此页保存你的修改。';
    login.target = '_blank'; login.rel = 'noopener';
    if (!panel.querySelector('a')) panel.append(login);
    panel.hidden = false;
    throw new Error('会话已过期，请重新登录。');
  }
  const body = await response.text();
  let parsed;
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = null; }
  if (!response.ok) throw new Error(parsed?.error || parsed?.message || '请求未完成（HTTP ' + response.status + '），请重试。');
  if (parsed?.success === false || parsed?.error) throw new Error(parsed.error || parsed.message || parsed.msg || '请求未完成，请检查配置。');
  if (text) return body;
  if (parsed === null) throw new Error('服务器返回了无法识别的内容，请刷新页面后重试。');
  return parsed;
}
function isConfigDirty() { return !!state.config && (JSON.stringify(state.config) !== state.baseline || state.rawDirty); }
function isAddressesDirty() { return state.addressesLoaded && $('custom-addresses').value !== state.addressesBaseline; }
function hasUnsaved() { return isConfigDirty() || isAddressesDirty() || state.cfDirty || state.tgDirty; }
function updateSaveState() {
  const dirty = isConfigDirty();
  $('save-config').disabled = !state.config || (!dirty && !state.busy) || state.busy;
  $('save-config').lastChild.textContent = state.busy ? '正在保存…' : '保存配置';
  const indicator = $('save-state');
  indicator.textContent = state.busy ? '正在保存' : dirty ? '有未保存修改' : state.config ? '配置已同步' : '尚未连接';
  indicator.classList.toggle('dirty', dirty && !state.busy);
  $('save-addresses').disabled = !isAddressesDirty() || state.busy;
  if (state.addressesLoaded) $('addresses-state').textContent = isAddressesDirty() ? '列表有未保存修改' : '已同步 · ' + $('custom-addresses').value.split('\n').filter((line) => line.trim()).length + ' 行';
}
function markChanged() {
  updateSaveState(); renderOverview(); renderSubscriptionLinks();
  if (!state.rawDirty) $('raw-config').value = JSON.stringify(state.config, null, 2);
}

const schema = {
  'node-identity-fields': [
    { label: '当前访问域名', path: ['HOST'], readOnly: true, hint: '由当前请求域名决定。', tag: 'HOST' },
    { label: '用户 UUID', path: ['UUID'], readOnly: true, secret: true, hint: '由 Cloudflare 环境变量 UUID 决定。', tag: 'UUID' },
    { label: '节点名称', path: ['优选订阅生成', 'SUBNAME'], required: true, hint: '客户端订阅中显示的名称。' },
    { label: 'WebSocket / HTTP 路径', path: ['PATH'], required: true, placeholder: '/', hint: '以 / 开头；部署设置中的 PATH 会覆盖此值。' },
    { label: '节点主机名', path: ['HOSTS'], type: 'array', full: true, required: true, rows: 3, hint: '每行一个可用域名。环境变量 HOST 存在时会覆盖此列表。' },
  ],
  'node-protocol-fields': [
    { label: '节点协议', path: ['协议类型'], type: 'select', options: [['vless', 'VLESS'], ['trojan', 'Trojan'], ['ss', 'Shadowsocks']] },
    { label: '传输协议', path: ['传输协议'], type: 'select', options: [['ws', 'WebSocket'], ['grpc', 'gRPC'], ['xhttp', 'XHTTP']] },
    { label: 'gRPC 模式', path: ['gRPC模式'], type: 'select', options: [['gun', 'gun（单流）'], ['multi', 'multi（多流）']], hint: '仅使用 gRPC 时生效。' },
    { label: 'gRPC User-Agent', path: ['gRPCUserAgent'], action: 'current-ua', hint: '用于 gRPC 订阅处理的客户端标识。' },
    { label: 'Shadowsocks 加密方式', path: ['SS', '加密方式'], type: 'select', options: ['aes-128-gcm', 'aes-256-gcm'], hint: '仅 Shadowsocks 生效。' },
    { label: 'Shadowsocks TLS', path: ['SS', 'TLS'], type: 'boolean', confirmDisable: true, hint: '为 Shadowsocks WebSocket 连接启用 TLS。关闭前会提示部署与 HTTP 端口要求。' },
  ],
  'node-security-fields': [
    { label: '浏览器指纹', path: ['Fingerprint'], type: 'select', options: ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'] },
    { label: 'ALPN', path: ['ALPN'], type: 'select', options: [['', '客户端默认'], ['h2,http/1.1', 'h2, http/1.1'], ['h2', 'h2'], ['http/1.1', 'http/1.1']] },
    { label: 'TLS 分片', path: ['TLS分片'], type: 'select', nullable: true, options: [['', '关闭'], ['Shadowrocket', 'Shadowrocket'], ['Happ', 'Happ']], hint: '需要客户端支持对应分片参数。' },
    { label: '跳过证书验证', path: ['跳过证书验证'], type: 'boolean', hint: '关闭时验证证书。仅在明确需要时开启。' },
    { label: '0-RTT', path: ['启用0RTT'], type: 'boolean', hint: '向节点路径加入早期数据参数。' },
    { label: '随机路径', path: ['随机路径'], type: 'boolean', hint: '生成订阅时使用随机路径。' },
    { label: 'ECH', path: ['ECH'], type: 'boolean', hint: '加密 ClientHello，需要客户端支持。' },
    { label: 'ECH DNS', path: ['ECHConfig', 'DNS'], placeholder: 'https://dns.alidns.com/dns-query', presets: ['https://dns.alidns.com/dns-query', 'https://sm2.doh.pub/dns-query', 'https://doh.360.cn/dns-query', 'https://doh.onedns.net/dns-query', 'https://doh.applied-privacy.net/query', 'https://odvr.nic.cz/doh', 'udp://208.67.220.220:443', 'udp://149.112.112.112:9953', 'udp://45.90.28.0:5353', 'udp://188.166.206.224:5003'], hint: '可输入自定义地址，或从下拉建议选择上游提供的 DNS。' },
    { label: 'ECH SNI', path: ['ECHConfig', 'SNI'], placeholder: '留空自动使用节点域名', presets: ['cloudflare-ech.com', 'crypto.cloudflare.com', 'encryptedsni.com', 'icook.hk', 'cm.edu.kg', 'godotengine.org', 'www.britannica.com', 'www.prometheus.io', 'www.kyocera.com', 'celestia.org', 'lido.fi'], hint: '用于解析 ECH Config 的域名；留空自动使用节点域名。' },
  ],
  'subscription-fields': [
    { label: '优选来源', path: ['优选订阅生成', 'local'], type: 'select', booleanSelect: true, options: [['true', '本地地址库'], ['false', '远程订阅生成器']] },
    { label: '订阅更新间隔', path: ['优选订阅生成', 'SUBUpdateTime'], type: 'number', min: 1, max: 720, hint: '单位：小时。客户端可能采用自己的刷新策略。' },
    { label: '随机 IP', path: ['优选订阅生成', '本地IP库', '随机IP'], type: 'boolean', hint: '开启：随机 IP；关闭：下方自定义地址列表。' },
    { label: '随机 IP 数量', path: ['优选订阅生成', '本地IP库', '随机数量'], type: 'number', min: 1, max: 100 },
    { label: '指定端口', path: ['优选订阅生成', '本地IP库', '指定端口'], type: 'number', min: -1, max: 65535, hint: '-1 表示自动选择端口。' },
    { label: '远程订阅生成器', path: ['优选订阅生成', 'SUB'], nullable: true, placeholder: '你的订阅生成器地址', hint: '选择远程来源时生效。' },
  ],
  'converter-fields': [
    { label: '订阅转换后端', path: ['订阅转换配置', 'SUBAPI'], full: true, hint: '转换后的订阅需要此服务。请使用自己信任的服务。' },
    { label: '转换规则地址', path: ['订阅转换配置', 'SUBCONFIG'], full: true },
    { label: '节点名称 Emoji', path: ['订阅转换配置', 'SUBEMOJI'], type: 'boolean' },
    { label: '仅输出节点列表', path: ['订阅转换配置', 'SUBLIST'], type: 'boolean' },
    { label: 'UDP', path: ['订阅转换配置', 'UDP'], type: 'boolean' },
    { label: 'XUDP', path: ['订阅转换配置', 'XUDP'], type: 'boolean' },
    { label: 'TLS 1.3', path: ['订阅转换配置', 'TLS13'], type: 'boolean' },
    { label: '名称附加节点类型', path: ['订阅转换配置', 'APPEND_TYPE'], type: 'boolean' },
    { label: '节点排序', path: ['订阅转换配置', 'SORT'], type: 'boolean' },
    { label: '展开规则全文', path: ['订阅转换配置', 'EXPAND'], type: 'boolean', hint: '向转换后端请求完整分流规则列表。' },
  ],
  'routing-fields': [
    { label: '反代出口', path: ['反代', 'PROXYIP'], placeholder: 'auto', full: true, hint: 'auto 自动选择；也可输入你自己的 IP 或域名及端口。' },
    { label: '上游代理类型', path: ['反代', 'SOCKS5', '启用'], type: 'select', nullable: true, options: [['', '关闭'], ['socks5', 'SOCKS5'], ['http', 'HTTP'], ['https', 'HTTPS'], ['turn', 'TURN'], ['sstp', 'SSTP']] },
    { label: '全局使用上游代理', path: ['反代', 'SOCKS5', '全局'], type: 'boolean', hint: '关闭时使用下方域名白名单。' },
    { label: '上游代理地址 / 账号', path: ['反代', 'SOCKS5', '账号'], secret: true, full: true, placeholder: 'user:password@host:port', hint: '请按代理服务提供的连接格式填写。' },
  ],
  'routing-whitelist-fields': [
    { label: '域名匹配规则', path: ['反代', 'SOCKS5', '白名单'], type: 'array', full: true, rows: 7, hint: '每行一条。支持上游实现的通配域名规则，例如 *.example.com。' },
  ],
  'tg-toggle-field': [{ label: '启用 Telegram 日志通知', path: ['TG', '启用'], type: 'boolean', full: true, hint: '开启并保存主配置后，新的日志事件才会发送到你的 Telegram。' }],
};
schema['routing-template-fields'] = [{ label: 'PROXYIP 路径模板', path: ['反代', '路径模板', 'PROXYIP'], full: true, placeholder: 'proxyip={{IP:PORT}}' }];
for (const type of ['SOCKS5', 'HTTP', 'HTTPS', 'TURN', 'SSTP']) {
  for (const mode of ['标准', '全局']) schema['routing-template-fields'].push({ label: type + ' ' + mode + '路径', path: ['反代', '路径模板', type, mode], placeholder: type.toLowerCase() + (mode === '全局' ? '://' : '=') + '{{IP:PORT}}' });
}

function createField(spec, { value, onChange, separate = false } = {}) {
  const wrapper = el('div', 'field' + (spec.full ? ' full-width' : ''));
  const id = spec.id || 'field-' + (++fieldSequence);
  const label = el('label', 'field-label', spec.label);
  label.htmlFor = id;
  if (spec.tag) label.append(el('span', 'field-tag', spec.tag));
  let input;
  if (spec.type === 'boolean') {
    const row = el('div', 'toggle-field');
    const text = el('div'); text.append(label);
    if (spec.hint) text.append(el('p', 'field-hint', spec.hint));
    const control = el('span', 'toggle-control');
    input = el('input'); input.type = 'checkbox'; input.id = id; input.checked = !!value;
    control.append(input, el('span', 'toggle-track')); row.append(text, control); wrapper.append(row);
  } else {
    wrapper.append(label);
    if (spec.type === 'select') {
      input = el('select');
      const choices = spec.options.map((option) => Array.isArray(option) ? option : [option, option]);
      const current = value === null || value === undefined ? '' : String(value);
      if (current && !choices.some(([key]) => key === current)) choices.push([current, current + '（当前值）']);
      choices.forEach(([key, name]) => { const option = el('option', '', name); option.value = key; input.append(option); });
      input.value = current;
    } else if (spec.type === 'array' || spec.type === 'textarea') {
      input = el('textarea'); input.rows = spec.rows || 4;
      input.value = Array.isArray(value) ? value.join('\n') : value ?? '';
    } else {
      input = el('input', 'field-input'); input.type = spec.secret ? 'password' : spec.type === 'number' ? 'number' : 'text';
      input.value = value ?? '';
      if (spec.min !== undefined) input.min = spec.min;
      if (spec.max !== undefined) input.max = spec.max;
      if (spec.type === 'number') input.step = '1';
    }
    input.id = id;
    if (spec.placeholder) input.placeholder = spec.placeholder;
    input.spellcheck = false;
    input.autocomplete = spec.secret ? 'new-password' : 'off';
    if (spec.readOnly) input.readOnly = true;
    if (spec.required) input.required = true;
    if (spec.secret) {
      const secret = el('div', 'secret-input'); secret.append(input);
      const reveal = el('button', 'reveal-button', '显示'); reveal.type = 'button';
      reveal.setAttribute('aria-label', '显示' + spec.label); reveal.setAttribute('aria-pressed', 'false');
      reveal.addEventListener('click', () => {
        const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
        reveal.textContent = visible ? '隐藏' : '显示';
        reveal.setAttribute('aria-label', (visible ? '隐藏' : '显示') + spec.label); reveal.setAttribute('aria-pressed', String(visible));
      });
      secret.append(reveal); wrapper.append(secret);
    } else wrapper.append(input);
    if (spec.presets) {
      const options = el('datalist'); options.id = id + '-presets'; input.setAttribute('list', options.id);
      spec.presets.forEach((value) => { const option = el('option'); option.value = value; options.append(option); }); wrapper.append(options);
    }
    if (spec.action === 'current-ua') {
      const action = el('button', 'button button-small field-inline-action', '获取当前浏览器 UA'); action.type = 'button';
      action.addEventListener('click', () => { input.value = navigator.userAgent; input.dispatchEvent(new Event('input', { bubbles: true })); toast('已填写当前浏览器 User-Agent，请保存配置。'); }); wrapper.append(action);
    }
    if (spec.hint) { const hint = el('p', 'field-hint', spec.hint); hint.id = id + '-hint'; input.setAttribute('aria-describedby', hint.id); wrapper.append(hint); }
  }
  input.addEventListener(spec.type === 'select' || spec.type === 'boolean' ? 'change' : 'input', async () => {
    if (spec.readOnly) return;
    let next = input.value;
    if (spec.type === 'boolean') next = input.checked;
    else if (spec.booleanSelect) next = next === 'true';
    else if (spec.type === 'number') { if (next === '' || !Number.isFinite(Number(next))) { input.setCustomValidity('请输入有效数字'); updateSaveState(); return; } input.setCustomValidity(''); next = Number(next); }
    else if (spec.type === 'array') next = next.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    else if (spec.nullable && next === '') next = null;
    if (spec.confirmDisable && next === false && read(spec.path) === true) {
      // Keep the accepted value in both the form and configuration until confirmation.
      input.checked = true;
      const confirmed = await confirmAction('关闭 Shadowsocks TLS？', '请先确认：\n1. 项目部署在 Workers，不能使用 Pages。\n2. 自定义域名关闭「始终使用 HTTPS」等 HTTPS 重定向，或使用项目分配的 workers.dev 域名。\n3. 优选地址使用 HTTP 端口，例如 80、8080、8880、2052、2082、2086、2095。\n\n关闭后不再有 TLS 包装，Shadowsocks AEAD 加密仍然保留。确认后还需保存主配置。', '确认关闭 TLS', true);
      if (!confirmed || !input.isConnected) return;
      input.checked = false;
    }
    if (onChange) onChange(next);
    else { write(spec.path, next); markChanged(); }
  });
  if (!separate && spec.path) bindings.push({ input, spec });
  return wrapper;
}
function renderFields() {
  bindings.length = 0;
  Object.entries(schema).forEach(([target, fields]) => {
    const container = $(target); container.replaceChildren();
    fields.forEach((spec) => container.append(createField(spec, { value: read(spec.path) })));
  });
  $('raw-config').value = JSON.stringify(state.config, null, 2);
  $('raw-error').hidden = true; $('raw-state').textContent = '与当前表单同步'; state.rawDirty = false;
}
function prettyNumber(value) { return new Intl.NumberFormat('zh-CN').format(value); }
function renderOverview() {
  if (!state.config) return;
  const c = state.config, usage = c.CF?.Usage;
  $('metric-protocol').textContent = (c.协议类型 || '未设置').toUpperCase();
  $('metric-transport').textContent = transportName(c.传输协议);
  $('metric-kv').textContent = state.meta?.kv === true ? '已绑定' : state.meta?.kv === false ? '未绑定' : '已读取';
  $('metric-version').textContent = state.meta?.version ? 'v' + state.meta.version : '—';
  $('metric-upstream').textContent = state.meta?.upstreamVersion ? '上游 ' + state.meta.upstreamVersion : '版本信息暂不可用';
  $('metric-usage').textContent = usage?.success && Number.isFinite(usage.total) ? prettyNumber(usage.total) : '未接入';
  $('metric-usage-detail').textContent = usage?.success ? 'Workers ' + prettyNumber(Number(usage.workers) || 0) + ' · Pages ' + prettyNumber(Number(usage.pages) || 0) : '可在设置中连接用量查询';
  $('overview-host').textContent = c.HOST || '未配置域名';
  $('overview-transport').textContent = transportName(c.传输协议);
  $('overview-name').textContent = c.优选订阅生成?.SUBNAME || '未设置';
  $('overview-path').textContent = c.完整节点路径 || c.PATH || '/';
  $('overview-security').textContent = (c.协议类型 === 'ss' && !c.SS?.TLS ? 'TLS 关闭' : 'TLS 开启') + ' · ECH ' + (c.ECH ? '开启' : '关闭');
  $('node-status').textContent = isConfigDirty() ? '待保存' : '已读取';
}
function transportName(value) { return ({ ws: 'WebSocket', grpc: 'gRPC', xhttp: 'XHTTP' })[value] || value || '未设置'; }
function subscriptionURL() {
  const token = state.config?.优选订阅生成?.TOKEN;
  if (!token) return '';
  const url = new URL('/sub', location.origin); url.searchParams.set('token', token);
  const format = $('subscription-format').value;
  if (format) url.searchParams.set('target', format);
  if (format === 'mixed') url.searchParams.set('b64', '1');
  return url.href;
}
async function copy(value) {
  if (!value) { toast('当前没有可复制的链接，请先保存节点配置。', true); return; }
  try { await navigator.clipboard.writeText(value); toast('已复制到剪贴板。'); }
  catch {
    const input = el('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.append(input); input.select();
    let success = false;
    try { success = document.execCommand('copy'); } catch { /* Clipboard availability differs by browser. */ }
    input.remove(); toast(success ? '已复制到剪贴板。' : '浏览器未授予剪贴板权限，请显示链接后手动复制。', !success);
  }
}
function renderSubscriptionLinks() {
  const container = $('subscription-links'); container.replaceChildren();
  const items = [ ['订阅地址', subscriptionURL()], ['单个节点链接', state.config?.LINK || ''] ];
  items.forEach(([label, value]) => {
    const row = el('div', 'link-field');
    const field = createField({ label, secret: true, readOnly: true, placeholder: '保存配置后生成' }, { value, separate: true });
    const button = el('button', 'button', '复制'); button.type = 'button'; button.disabled = !value;
    button.setAttribute('aria-label', '复制' + label);
    button.addEventListener('click', () => copy(value));
    const actions = el('div', 'link-actions');
    const qr = el('button', 'button', '二维码'); qr.type = 'button'; qr.disabled = !value; qr.setAttribute('aria-label', '显示' + label + '二维码');
    qr.addEventListener('click', () => window.BrclioTools?.showQR(label, value));
    actions.append(qr, button); row.append(field, actions); container.append(row);
  });
  $('download-subscription').disabled = !subscriptionURL();
}
function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const link = el('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const integrations = {
  cf: [
    { id: 'cf-Email', label: '账户邮箱', key: 'Email', placeholder: '使用 Global API Key 时填写' },
    { id: 'cf-GlobalAPIKey', label: 'Global API Key', key: 'GlobalAPIKey', secret: true, placeholder: '可选，推荐使用 API Token' },
    { id: 'cf-AccountID', label: 'Account ID', key: 'AccountID', secret: true, placeholder: 'Cloudflare 账户 ID' },
    { id: 'cf-APIToken', label: 'API Token', key: 'APIToken', secret: true, placeholder: '填写你的只读查询 Token' },
    { id: 'cf-UsageAPI', label: '自定义用量 API', key: 'UsageAPI', full: true, placeholder: 'https://…', hint: '三种方式任选一组：账户 ID + Token，邮箱 + Global Key，或自定义 API。' },
  ],
  tg: [
    { id: 'tg-BotToken', label: 'Bot Token', key: 'BotToken', secret: true, placeholder: '由 BotFather 提供' },
    { id: 'tg-ChatID', label: 'Chat ID', key: 'ChatID', placeholder: '接收通知的聊天 ID' },
  ],
};
function renderIntegration(kind) {
  const data = state.config[kind.toUpperCase()] || {};
  const container = $(kind + '-fields'); container.replaceChildren();
  integrations[kind].forEach((spec) => {
    const fieldSpec = { ...spec, placeholder: data[spec.key] ? '已配置 · 留空保留，输入新值替换' : spec.placeholder };
    container.append(createField(fieldSpec, { value: '', separate: true, onChange: () => { state[kind + 'Dirty'] = true; } }));
  });
  $(kind + '-status').textContent = kind === 'cf' ? data.Usage?.success ? '已连接' : data.APIToken || data.GlobalAPIKey || data.UsageAPI ? '已配置' : '可选' : data.BotToken ? data.启用 ? '通知已开启' : '已配置 · 通知关闭' : '可选';
  state[kind + 'Dirty'] = false;
}
async function saveIntegration(kind, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {};
  integrations[kind].forEach((spec) => { const value = $(spec.id).value.trim(); if (value) body[spec.key] = value; });
  if (!Object.keys(body).length) { toast('请填写要更新的凭据；留空的字段会保留。'); return; }
  if (kind === 'cf' && body.UsageAPI && (body.APIToken || body.GlobalAPIKey || body.AccountID || body.Email)) { toast('请选择一种 Cloudflare 认证方式，自定义 API 不与其他凭据同时填写。', true); return; }
  if (kind === 'cf' && (body.APIToken || body.AccountID) && (body.Email || body.GlobalAPIKey)) { toast('请选择 API Token 或 Global API Key 其中一种认证方式。', true); return; }
  const submit = form.querySelector('[type="submit"]'); const initialText = submit.textContent;
  submit.disabled = true; submit.textContent = '正在保存…';
  form.querySelectorAll('input').forEach((input) => { input.disabled = true; });
  try {
    await api('/admin/' + kind + '.json', { method: 'POST', data: body });
    state[kind + 'Dirty'] = false;
    integrations[kind].forEach((spec) => { $(spec.id).value = ''; if (body[spec.key]) $(spec.id).placeholder = '已配置 · 留空保留，输入新值替换'; });
    $(kind + '-status').textContent = '已保存';
    toast(kind === 'cf' ? 'Cloudflare 用量配置已保存。刷新概览可更新用量。' : 'Bot 配置已保存。需要通知时，请开启下方开关并保存主配置。');
  } catch (error) { toast(error.message, true); }
  finally { submit.disabled = false; submit.textContent = initialText; form.querySelectorAll('input').forEach((input) => { input.disabled = false; }); }
}
async function clearIntegration(kind) {
  const name = kind === 'cf' ? 'Cloudflare 用量' : 'Telegram Bot';
  if (!await confirmAction('移除' + name + '配置？', '保存在当前工作空间的凭据将被清除。' + (kind === 'tg' ? '建议同时关闭日志通知。' : ''), '移除配置', true)) return;
  const button = $('clear-' + kind); button.disabled = true;
  try {
    await api('/admin/' + kind + '.json', { method: 'POST', data: { init: true } });
    if (kind === 'cf') state.config.CF = { Usage: { success: false } };
    else state.config.TG = { 启用: state.config.TG?.启用 || false, BotToken: null, ChatID: null };
    // API-owned masked fields are display metadata, not unsaved main edits.
    const baseline = JSON.parse(state.baseline); baseline[kind.toUpperCase()] = clone(state.config[kind.toUpperCase()]); state.baseline = JSON.stringify(baseline);
    renderIntegration(kind); renderOverview(); updateSaveState(); toast(name + '配置已移除。');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}

function logType(item) { return item.TYPE || item.type || '其他'; }
function logTime(item) { const time = item.TIME ?? item.time ?? item.timestamp; const date = new Date(time); return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false }); }
function cleanLogURL(value) {
  if (!value) return '—';
  try {
    const url = new URL(value, location.origin);
    for (const key of Array.from(url.searchParams.keys())) if (/token|password|uuid|key|secret/i.test(key)) url.searchParams.set(key, '••••');
    return url.pathname + url.search;
  } catch { return String(value).slice(0, 400); }
}
function normalizedLogs(data) {
  const items = Array.isArray(data) ? data : Array.isArray(data?.logs) ? data.logs : data && typeof data === 'object' ? Object.values(data).filter((item) => item && typeof item === 'object') : [];
  return items.filter((item) => item && typeof item === 'object').sort((a, b) => Number(new Date(b.TIME ?? b.time ?? b.timestamp)) - Number(new Date(a.TIME ?? a.time ?? a.timestamp)));
}
function renderRecentLogs(error) {
  const container = $('recent-logs'); container.replaceChildren();
  if (error) { container.append(el('p', 'empty-inline', '日志暂时无法读取。请在「访问日志」中重试。')); return; }
  if (!state.logs.length) { container.append(el('p', 'empty-inline', '还没有访问记录。获取订阅或修改配置后，可在这里查看。')); return; }
  state.logs.slice(0, 4).forEach((item) => {
    const row = el('div', 'recent-row'); const glyph = el('span', 'recent-icon'); glyph.append(icon('log'));
    const content = el('div'); content.append(el('strong', '', logType(item)), el('p', '', item.IP || item.ip || '来源未知'));
    const time = el('time', '', logTime(item));
    row.append(glyph, content, el('span', 'recent-place', item.CC || item.country || '—'), time); container.append(row);
  });
}
function renderLogRows() {
  const search = $('log-search').value.trim().toLowerCase(), filter = $('log-filter').value;
  const logs = state.logs.filter((item) => (!filter || logType(item) === filter) && (!search || JSON.stringify(item).toLowerCase().includes(search)));
  const pages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE)); state.logPage = Math.min(state.logPage, pages - 1);
  $('log-count').textContent = logs.length + ' 条记录';
  const tbody = $('log-rows'); tbody.replaceChildren();
  logs.slice(state.logPage * PAGE_SIZE, (state.logPage + 1) * PAGE_SIZE).forEach((item) => {
    const row = el('tr');
    row.append(el('td', '', logTime(item)));
    const type = el('td'); type.append(el('span', 'log-type', logType(item))); row.append(type);
    const source = el('td', '', item.IP || item.ip || '—'); source.append(el('small', '', item.CC || item.country || '未知地区')); row.append(source);
    const detail = el('td'); detail.append(el('div', 'log-url', cleanLogURL(item.URL || item.url)));
    const disclosure = el('details'); disclosure.append(el('summary', '', '查看设备与网络'));
    disclosure.append(el('div', 'log-detail', 'ASN：' + (item.ASN || item.asn || '—') + '\nUser-Agent：' + (item.UA || item.ua || '—')));
    detail.append(disclosure); row.append(detail); tbody.append(row);
  });
  $('logs-empty').hidden = logs.length > 0;
  $('log-pagination').hidden = !logs.length;
  $('log-page-label').textContent = '第 ' + (state.logPage + 1) + ' / ' + pages + ' 页 · 每页 ' + PAGE_SIZE + ' 条';
  $('logs-previous').disabled = state.logPage === 0;
  $('logs-next').disabled = state.logPage >= pages - 1;
}
async function loadLogs() {
  const button = $('refresh-logs'); button.disabled = true; $('log-error').hidden = true;
  try {
    state.logs = normalizedLogs(await api('/admin/log.json')); state.logsLoaded = true;
    const select = $('log-filter'), previous = select.value;
    select.replaceChildren(); const all = el('option', '', '全部类型'); all.value = ''; select.append(all);
    [...new Set(state.logs.map(logType))].sort().forEach((type) => { const option = el('option', '', type); option.value = type; select.append(option); });
    if (Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
    renderLogRows(); renderRecentLogs();
  } catch (error) { $('log-error').hidden = false; $('log-error').textContent = error.message; renderRecentLogs(true); }
  finally { button.disabled = false; }
}
async function loadAddresses() {
  try {
    const value = await api('/admin/ADD.txt', { text: true });
    $('custom-addresses').value = value; state.addressesBaseline = value; state.addressesLoaded = true;
  } catch (error) { $('addresses-state').textContent = '读取失败：' + error.message; state.addressesLoaded = false; }
  updateSaveState();
}
async function loadWorkspace({ preserveSeparate = false } = {}) {
  if (!state.config) $('loading-panel').hidden = false;
  $('global-error').hidden = true; $('refresh-config').disabled = true;
  try {
    const results = await Promise.allSettled([api('/admin/config.json'), api('/admin/meta')]);
    if (results[0].status !== 'fulfilled') throw results[0].reason;
    const value = results[0].value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置不是有效的 JSON 对象。');
    state.config = clone(value); state.baseline = JSON.stringify(value); state.rawDirty = false;
    if (results[1].status === 'fulfilled') state.meta = results[1].value;
    renderFields(); renderOverview(); renderSubscriptionLinks();
    if (!preserveSeparate) { renderIntegration('cf'); renderIntegration('tg'); }
    $('loading-panel').hidden = true; $('app-content').hidden = false;
    $('last-refreshed').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    updateSaveState();
    window.dispatchEvent(new CustomEvent('brclio:config'));
    if (!preserveSeparate) await Promise.allSettled([loadAddresses(), loadLogs()]);
    return true;
  } catch (error) {
    $('loading-panel').hidden = true; $('global-error').hidden = false; $('global-error-text').textContent = error.message;
    if (!state.config) $('save-state').textContent = '连接未完成';
    return false;
  } finally { $('refresh-config').disabled = false; }
}
function validateConfig() {
  for (const { input, spec } of bindings) {
    if (spec.readOnly) continue;
    if (!input.checkValidity()) {
      const page = input.closest('.page'); if (page) navigate(page.id.slice(5));
      const details = input.closest('details'); if (details) details.open = true;
      input.reportValidity(); return false;
    }
  }
  if (typeof state.config.PATH !== 'string' || !state.config.PATH.startsWith('/')) { toast('节点路径必须以 / 开头。', true); navigate('nodes'); return false; }
  if (!Array.isArray(state.config.HOSTS) || !state.config.HOSTS.length) { toast('请至少填写一个节点主机名。', true); navigate('nodes'); return false; }
  const port = state.config.优选订阅生成?.本地IP库?.指定端口;
  if (port !== -1 && (!Number.isInteger(port) || port < 1 || port > 65535)) { toast('指定端口需填写 -1（自动），或 1–65535 之间的整数。', true); navigate('subscriptions'); return false; }
  if (state.config.优选订阅生成?.local === false && !state.config.优选订阅生成.SUB?.trim()) { toast('使用远程来源时，请填写远程订阅生成器地址。', true); navigate('subscriptions'); return false; }
  return true;
}
function applyRaw({ notify = true } = {}) {
  try {
    const value = JSON.parse($('raw-config').value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('顶层必须是 JSON 对象。');
    for (const key of ['优选订阅生成', '订阅转换配置', '反代']) if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) throw new Error('缺少对象字段：' + key);
    state.config = value; state.rawDirty = false; renderFields(); renderOverview(); renderSubscriptionLinks(); updateSaveState();
    if (notify) toast('JSON 已应用到表单，请点击顶部保存配置。');
    return true;
  } catch (error) { $('raw-error').textContent = 'JSON 无法应用：' + error.message; $('raw-error').hidden = false; navigate('settings'); $('raw-disclosure').open = true; $('raw-config').focus(); return false; }
}
async function saveConfig() {
  if (!state.config || state.busy) return;
  if (state.rawDirty && !applyRaw({ notify: false })) return;
  if (!validateConfig()) return;
  state.busy = true; updateSaveState();
  // Prevent edits during the request, so successful persistence cannot overwrite newer form input.
  bindings.forEach(({ input }) => { input.disabled = true; }); $('raw-config').disabled = true;
  try {
    await api('/admin/config.json', { method: 'POST', data: state.config });
    const loaded = await loadWorkspace({ preserveSeparate: true });
    toast(loaded ? '配置已保存。请在客户端更新订阅。' : '配置已保存，但重新读取失败。请刷新确认最新状态。', !loaded);
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; bindings.forEach(({ input }) => { input.disabled = false; }); $('raw-config').disabled = false; updateSaveState(); }
}
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar').inert = window.matchMedia('(max-width: 900px)').matches; $('sidebar-shade').hidden = true; $('menu-toggle').setAttribute('aria-expanded', 'false'); $('menu-toggle').setAttribute('aria-label', '打开导航'); }
function navigate(page, { hash = true } = {}) {
  if (!pageNames[page]) page = 'overview';
  state.page = page;
  document.querySelectorAll('.page').forEach((section) => { section.hidden = section.id !== 'page-' + page; });
  document.querySelectorAll('[data-nav]').forEach((link) => { const active = link.dataset.nav === page; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('breadcrumb-current').textContent = pageNames[page]; document.title = pageNames[page] + ' · Brclio Edge';
  if (hash && location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
  closeSidebar(); window.scrollTo({ top: 0 });
  document.dispatchEvent(new CustomEvent('brclio:navigate', { detail: page }));
  if (page === 'logs' && state.config && !state.logsLoaded) loadLogs();
}

$('menu-toggle').addEventListener('click', () => { const opened = $('sidebar').classList.toggle('open'); $('sidebar').inert = !opened; $('sidebar-shade').hidden = !opened; $('menu-toggle').setAttribute('aria-expanded', String(opened)); $('menu-toggle').setAttribute('aria-label', opened ? '关闭导航' : '打开导航'); });
window.matchMedia('(max-width: 900px)').addEventListener('change', closeSidebar);
$('sidebar-shade').addEventListener('click', closeSidebar);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSidebar(); });
document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', (event) => { const page = link.getAttribute('href').slice(1); if (pageNames[page]) { event.preventDefault(); navigate(page); } }));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1), { hash: false }));
window.addEventListener('beforeunload', (event) => { if (hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } });
$('logout').addEventListener('click', async (event) => { if (hasUnsaved()) { event.preventDefault(); if (await confirmAction('退出前，有内容尚未保存', '退出后未保存的修改将丢失。', '放弃修改并退出', true)) { state.config = null; state.rawDirty = false; state.cfDirty = false; state.tgDirty = false; state.addressesLoaded = false; location.href = '/logout'; } } });
$('save-config').addEventListener('click', saveConfig);
$('refresh-config').addEventListener('click', async () => { if (hasUnsaved() && !await confirmAction('重新读取已保存配置？', '当前表单、地址列表和服务凭据中未保存的修改将被丢弃。', '放弃修改并刷新')) return; if (await loadWorkspace()) toast('工作空间已刷新。'); });
$('retry-load').addEventListener('click', async () => { if (hasUnsaved() && !await confirmAction('重新读取已保存配置？', '未保存的修改将被丢弃。', '重新读取')) return; loadWorkspace(); });
$('subscription-format').addEventListener('change', renderSubscriptionLinks);
$('download-subscription').addEventListener('click', async () => {
  const button = $('download-subscription'); button.disabled = true; const initial = button.textContent; button.textContent = '正在生成…';
  try { const content = await api(subscriptionURL(), { text: true }); const format = $('subscription-format').value; const extension = format === 'clash' ? '.yaml' : format === 'singbox' ? '.json' : '.txt'; downloadFile(content, 'brclio-edge-' + (format || 'auto') + extension, 'text/plain'); toast('订阅文件已生成。'); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = initial; }
});
$('custom-addresses').addEventListener('input', updateSaveState);
$('save-addresses').addEventListener('click', async () => {
  if (!state.addressesLoaded) return;
  const button = $('save-addresses'), input = $('custom-addresses'); button.disabled = true; input.disabled = true; button.textContent = '正在保存…';
  try { await api('/admin/ADD.txt', { method: 'POST', data: input.value }); state.addressesBaseline = input.value; toast('自定义地址列表已保存。'); }
  catch (error) { toast(error.message, true); }
  finally { input.disabled = false; button.textContent = '保存地址列表'; updateSaveState(); }
});
$('refresh-logs').addEventListener('click', loadLogs);
$('log-search').addEventListener('input', () => { state.logPage = 0; renderLogRows(); });
$('log-filter').addEventListener('change', () => { state.logPage = 0; renderLogRows(); });
$('logs-previous').addEventListener('click', () => { state.logPage = Math.max(0, state.logPage - 1); renderLogRows(); });
$('logs-next').addEventListener('click', () => { state.logPage += 1; renderLogRows(); });
for (const kind of ['cf', 'tg']) {
  $(kind + '-form').addEventListener('submit', (event) => saveIntegration(kind, event));
  $('clear-' + kind).addEventListener('click', () => clearIntegration(kind));
}
$('raw-config').addEventListener('input', () => { state.rawDirty = true; $('raw-state').textContent = 'JSON 已修改，尚未应用'; updateSaveState(); });
$('apply-raw').addEventListener('click', () => applyRaw());
$('export-config').addEventListener('click', async () => {
  if (state.rawDirty && !applyRaw({ notify: false })) return;
  if (!await confirmAction('导出当前主配置？', '备份包含 UUID 访问凭据，请妥善保管。当前尚未保存的主配置修改也会包含在内。', '导出 JSON')) return;
  const backup = clone(state.config);
  for (const key of ['CF', 'LINK', '完整节点路径', '加载时间', 'init', 'TIME', 'TOKEN']) delete backup[key];
  if (backup.优选订阅生成) delete backup.优选订阅生成.TOKEN;
  if (backup.TG) backup.TG = { 启用: Boolean(backup.TG.启用) };
  downloadFile(JSON.stringify(backup, null, 2), 'brclio-edge-config-' + new Date().toISOString().slice(0, 10) + '.json'); toast('主配置已导出。');
});
$('import-config').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('配置文件不能超过 2 MB。');
    const text = await file.text(); JSON.parse(text);
    if (!await confirmAction('导入这份主配置？', '文件：' + file.name + '\n将替换当前主配置表单。应用后仍需点击顶部「保存配置」。', '导入到表单')) return;
    $('raw-config').value = text; state.rawDirty = true; if (applyRaw()) $('raw-disclosure').open = true;
  } catch (error) { toast('导入失败：' + error.message, true); }
  finally { event.target.value = ''; }
});
$('reset-config').addEventListener('click', async () => {
  if (!await confirmAction('恢复默认主配置？', '当前保存的节点与订阅配置会被覆盖，此操作无法撤销。请确认你已导出所需备份。', '确认重置', true)) return;
  const button = $('reset-config'); button.disabled = true; button.textContent = '正在重置…';
  try { await api('/admin/init', { method: 'POST', data: {} }); await loadWorkspace({ preserveSeparate: true }); toast('主配置已恢复默认。请在客户端更新订阅。'); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = '重置配置'; }
});

function appendAddresses(lines) {
  if (!state.addressesLoaded) { toast('请先成功读取自定义地址列表，再追加内容。', true); return false; }
  const values = (Array.isArray(lines) ? lines : String(lines).split('\n')).map((line) => String(line).trim()).filter(Boolean);
  if (!values.length) { toast('没有可追加的地址。', true); return false; }
  const existing = $('custom-addresses').value.trim();
  $('custom-addresses').value = (existing ? existing + '\n' : '') + values.join('\n');
  write(['优选订阅生成', 'local'], true); write(['优选订阅生成', '本地IP库', '随机IP'], false);
  renderFields(); markChanged(); navigate('subscriptions');
  toast('已追加 ' + values.length + ' 行。请保存地址列表，并保存主配置中的本地来源设置。');
  return true;
}
window.BrclioUI = {
  appendAddresses, navigate, toast, getConfig: () => state.config, getMeta: () => state.meta, read, write, api, copy, confirmAction,
  markChanged, renderFields, renderOverview, downloadFile,
  setField: (path, value) => { write(path, value); renderFields(); markChanged(); },
  setUsage: (usage) => { state.config.CF ||= {}; state.config.CF.Usage = usage; const baseline = JSON.parse(state.baseline); baseline.CF ||= {}; baseline.CF.Usage = clone(usage); state.baseline = JSON.stringify(baseline); renderOverview(); updateSaveState(); },
};
navigate(location.hash.slice(1), { hash: false });
loadWorkspace();
