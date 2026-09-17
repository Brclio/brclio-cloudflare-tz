/* SPDX-License-Identifier: GPL-2.0-only · Original Brclio Edge workspace tools. */
'use strict';
(() => {
  const B = window.BrclioUI;
  if (!B) return;
  const $ = (id) => document.getElementById(id);
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const button = (label, id, action, primary = false) => { const node = make('button', 'button button-small' + (primary ? ' button-primary' : ''), label); node.type = 'button'; if (id) node.id = id; if (action) node.addEventListener('click', async (event) => { try { await action(event); } catch (error) { B.toast(error?.message || '操作未完成，请重试。', true); } }); return node; };
  const link = (label, href) => { const node = make('a', 'text-link', label); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; };
  function field(parent, labelText, id, { value = '', placeholder = '', type = 'text', options, min, max, full = false } = {}) {
    const wrapper = make('div', 'field' + (full ? ' full-width' : ''));
    const label = make('label', 'field-label', labelText); label.htmlFor = id;
    let input;
    if (options) { input = make('select', 'field-input'); options.forEach((item) => { const [key, text] = Array.isArray(item) ? item : [item, item]; const option = make('option', '', text); option.value = key; input.append(option); }); }
    else if (type === 'textarea') { input = make('textarea', 'code-input'); input.rows = 7; }
    else { input = make('input', 'field-input'); input.type = type; }
    input.id = id; input.value = value;
    if (options && input.selectedIndex < 0 && input.options.length) input.selectedIndex = 0;
    input.placeholder = placeholder; input.autocomplete = 'off'; input.spellcheck = false;
    if (min !== undefined) input.min = min; if (max !== undefined) input.max = max;
    wrapper.append(label);
    if (type === 'password') { const secret = make('div', 'secret-input'); const reveal = button('显示', null, () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; reveal.textContent = show ? '隐藏' : '显示'; reveal.setAttribute('aria-pressed', String(show)); }); reveal.className = 'reveal-button'; reveal.setAttribute('aria-label', '显示或隐藏' + labelText); reveal.setAttribute('aria-pressed', 'false'); secret.append(input, reveal); wrapper.append(secret); }
    else wrapper.append(input);
    parent.append(wrapper); return input;
  }
  function panel(target, title, description, { details = false, advanced = false } = {}) {
    const section = make(details ? 'details' : 'section', 'form-section tool-section' + (details ? ' disclosure' : '') + (advanced ? ' advanced-tool' : ''));
    const heading = make(details ? 'summary' : 'div', details ? '' : 'section-heading');
    const labels = make('div'); labels.append(make('span', 'small-caps', 'WORKSPACE TOOLS'), make('h2', '', title)); heading.append(labels);
    if (details) heading.append(make('span', '', '展开 / 收起'));
    section.append(heading); if (description) section.append(make('p', 'field-hint tool-intro', description));
    const content = make('div', 'tool-content'); section.append(content); $(target).append(section); return content;
  }
  function actions(parent, ...items) { const row = make('div', 'tool-actions'); row.append(...items); parent.append(row); return row; }
  function status(parent, id) { const node = make('div', 'tool-status'); node.id = id; node.hidden = true; node.setAttribute('role', 'status'); parent.append(node); return node; }
  function showStatus(node, text, error = false) { node.hidden = false; node.classList.toggle('is-error', error); node.textContent = text; }
  async function run(buttonNode, statusNode, work) {
    const original = buttonNode.textContent; buttonNode.disabled = true; buttonNode.textContent = '正在处理…';
    if (statusNode) showStatus(statusNode, '请求进行中，请稍候。');
    try { return await work(); } catch (error) { if (statusNode) showStatus(statusNode, error.message, true); else B.toast(error.message, true); return null; }
    finally { buttonNode.disabled = false; buttonNode.textContent = original; }
  }
  function normalizeProxy(value) { return String(value).trim().replace(/^\//, '').replace(/^(?:socks5|http|https|turn|sstp|proxyip)(?::\/\/|=)/i, '').split('#')[0].trim(); }
  function resultDescription(result) {
    const text = ['连接成功']; if (result.ip) text.push('出口 ' + result.ip); if (result.loc) text.push('地区 ' + result.loc);
    if (result.responseTime !== undefined) text.push('响应 ' + result.responseTime + ' ms');
    if (result.supports_ipv4 !== undefined) text.push('IPv4 ' + (result.supports_ipv4 ? '可用' : '不可用'));
    if (result.supports_ipv6 !== undefined) text.push('IPv6 ' + (result.supports_ipv6 ? '可用' : '不可用'));
    return text.join(' · ');
  }
  async function catalog(kind) { return B.api('/admin/catalog?kind=' + encodeURIComponent(kind)); }
  function sourceNote(parent, source) { const note = make('p', 'field-hint catalog-source', '第三方来源：'); if (source) note.append(link(new URL(source).hostname + ' ↗', source)); parent.append(note); return note; }
  function replaceConfigField(path, value) { B.setField(path, value); B.toast('已应用到主配置表单，请点击顶部「保存配置」。'); }
  function locationMap(points, caption = '来源提供的经纬位置示意') {
    const figure = make('figure', 'location-map'); const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 600 300'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', caption);
    const grid = document.createElementNS(ns, 'path'); let lines = '';
    for (let x = 0; x <= 600; x += 100) lines += 'M' + x + ' 0V300';
    for (let y = 0; y <= 300; y += 50) lines += 'M0 ' + y + 'H600';
    grid.setAttribute('d', lines); grid.setAttribute('class', 'map-grid'); svg.append(grid);
    const continents = document.createElementNS(ns, 'path');
    continents.setAttribute('d', 'M25 63 77 30 154 36 176 58 160 86 137 106 130 133 95 122 86 99 47 98ZM143 143 177 154 194 183 175 221 159 251 144 209 126 169ZM230 25 258 19 270 45 249 64 225 45ZM286 80 307 60 338 64 349 88 377 85 391 115 369 141 331 139 310 112ZM305 127 347 127 378 156 365 196 341 223 323 183 296 158ZM338 57 392 40 458 49 539 54 565 78 544 99 512 112 494 135 475 149 450 122 421 130 399 100 365 95ZM420 130 450 140 464 167 449 180 435 159ZM477 193 519 178 549 205 531 229 486 224ZM557 239 565 225 572 240 562 253');
    continents.setAttribute('class', 'map-land'); svg.append(continents);
    for (const point of points) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
      const circle = document.createElementNS(ns, 'circle'); circle.setAttribute('cx', String((point.longitude + 180) / 360 * 600)); circle.setAttribute('cy', String((90 - point.latitude) / 180 * 300)); circle.setAttribute('r', '4'); circle.setAttribute('class', 'map-point');
      const title = document.createElementNS(ns, 'title'); title.textContent = (point.label || '') + ' (' + point.latitude + ', ' + point.longitude + ')'; circle.append(title); svg.append(circle);
    }
    figure.append(svg, make('figcaption', '', caption + '；陆地轮廓为简化示意。')); return figure;
  }
  async function showIPDetail(ip) {
    const dialog = make('dialog', 'confirm-dialog ip-detail-dialog'); dialog.append(make('span', 'small-caps', 'IP INFORMATION'), make('h2', '', '出口 IP 详情'));
    const loading = make('p', 'field-hint', '正在查询 ' + ip + ' 的公开网络信息…'); dialog.append(loading);
    const content = make('div', 'ip-detail-body'); dialog.append(content); actions(dialog, button('关闭详情', null, () => dialog.close(), true));
    dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
    try {
      const response = await B.api('/admin/ipDetail', { method: 'POST', data: { ip } }); if (!dialog.open) return;
      const data = response.data || {}, location = data.location || {}, asn = data.asn || {}, company = data.company || {};
      loading.textContent = '以下信息由第三方数据库提供，仅反映该来源的标记。';
      const details = make('dl', 'detail-list');
      const values = [['IP', data.ip || ip], ['地区', [location.country, location.state, location.city].filter(Boolean).join(' · ')], ['时区', location.timezone], ['ASN', asn.asn ? 'AS' + asn.asn : null], ['网络组织', asn.org || asn.descr || company.name], ['运营商类型', asn.type || company.type], ['网段', asn.route || company.network], ['来源风险评分', asn.abuser_score || company.abuser_score]];
      for (const [label, value] of values) if (value !== undefined && value !== null && value !== '') { details.append(make('dt', '', label), make('dd', '', String(value))); }
      content.append(details); const flags = make('div', 'ip-flags');
      for (const [key, label] of [['is_proxy', '代理'], ['is_vpn', 'VPN'], ['is_tor', 'Tor'], ['is_datacenter', '数据中心'], ['is_crawler', '爬虫'], ['is_mobile', '移动网络'], ['is_satellite', '卫星网络'], ['is_abuser', '滥用标记'], ['is_bogon', '保留地址']]) if (typeof data[key] === 'boolean') flags.append(make('span', 'outline-tag', label + '：' + (data[key] ? '是' : '否')));
      content.append(flags);
      if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) { content.append(locationMap([{ ...location, label: data.ip || ip }])); content.append(link('在 OpenStreetMap 查看位置 ↗', 'https://www.openstreetmap.org/?mlat=' + location.latitude + '&mlon=' + location.longitude + '#map=8/' + location.latitude + '/' + location.longitude)); }
      sourceNote(content, response.source || 'https://api.ipapi.is/');
    } catch (error) { loading.textContent = error.message; loading.className = 'inline-error'; }
  }
  function addIPDetailAction(parent, response) { if (response.ip && response.ip !== '未知') parent.append(button('查询 IP 详情', null, () => showIPDetail(response.ip))); }

  // QR codes are generated locally. Closing the dialog removes the credential-bearing graphic.
  function showQR(label, value) {
    if (typeof window.qrcode !== 'function') { B.toast('二维码组件未加载，请刷新后重试。', true); return; }
    const dialog = make('dialog', 'confirm-dialog qr-dialog');
    dialog.append(make('span', 'small-caps', 'SCAN TO CONNECT'), make('h2', '', label));
    try {
      const code = window.qrcode(0, 'M'); code.addData(value, 'Byte'); code.make();
      const count = code.getModuleCount(), quiet = 4;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 ' + (count + quiet * 2) + ' ' + (count + quiet * 2)); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label + '二维码'); svg.setAttribute('class', 'qr-image'); svg.setAttribute('shape-rendering', 'crispEdges');
      const path = document.createElementNS(svg.namespaceURI, 'path'); let cells = '';
      for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) if (code.isDark(row, column)) cells += 'M' + (column + quiet) + ' ' + (row + quiet) + 'h1v1h-1z';
      path.setAttribute('d', cells); path.setAttribute('fill', '#242b30'); svg.append(path); dialog.append(svg);
      dialog.append(make('p', 'field-hint', '二维码包含连接凭据。使用可信客户端扫描，完成后关闭。'));
      actions(dialog, button('关闭二维码', null, () => dialog.close(), true));
      dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
    } catch { B.toast('当前链接过长，无法生成二维码，请使用复制链接。', true); }
  }

  // Display preferences contain no account or connection credentials.
  let theme = 'light', mode = 'full';
  try { theme = localStorage.getItem('brclio-edge-theme') || 'light'; mode = localStorage.getItem('brclio-edge-view') || 'full'; } catch { /* Storage is optional. */ }
  function applyTheme(value) { theme = value === 'dark' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? '切换日间主题' : '切换夜间主题'); try { localStorage.setItem('brclio-edge-theme', theme); } catch {} }
  function applyMode(value, { expand = false } = {}) {
    mode = value === 'simple' ? 'simple' : 'full'; document.body.dataset.view = mode;
    if ($('view-mode')) $('view-mode').value = mode;
    $('expert-mode').checked = mode === 'full';
    $('expert-mode-status').textContent = mode === 'full' ? '已开启 · 完整视图' : '已关闭 · 简洁视图';
    if (expand && mode === 'full') document.querySelectorAll('details.advanced-tool').forEach((section) => { section.open = true; });
    try { localStorage.setItem('brclio-edge-view', mode); } catch {}
  }
  $('expert-mode').addEventListener('change', () => applyMode($('expert-mode').checked ? 'full' : 'simple', { expand: true }));
  $('theme-toggle').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
  applyTheme(theme); applyMode(mode);
  const hostsNotice = make('div', 'hosts-notice'); hostsNotice.id = 'hosts-mismatch-notice'; hostsNotice.hidden = true; hostsNotice.setAttribute('role', 'status');
  const hostsNoticeText = make('div'); hostsNoticeText.append(make('strong', '', '当前访问域名与节点主机列表不同')); const hostsNoticeDescription = make('p'); hostsNoticeText.append(hostsNoticeDescription); hostsNotice.append(hostsNoticeText);
  let hostsNoticeUntil = 0;
  try { hostsNoticeUntil = Number(localStorage.getItem('brclio-edge-host-notice-until')) || 0; } catch {}
  actions(hostsNotice, button('查看主机配置', 'review-hosts', () => B.navigate('nodes')), button('24 小时不再提示', 'dismiss-hosts-notice', () => { hostsNoticeUntil = Date.now() + 24 * 60 * 60 * 1000; try { localStorage.setItem('brclio-edge-host-notice-until', String(hostsNoticeUntil)); } catch {} hostsNotice.hidden = true; }));
  $('app-content').prepend(hostsNotice);
  function normalizeHostname(value) {
    const text = String(value).trim().toLowerCase();
    try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'http://' + text).hostname.replace(/\.$/, ''); }
    catch { return text.replace(/:\d+$/, '').replace(/\.$/, ''); }
  }
  function renderHostsNotice() {
    const hosts = B.getConfig()?.HOSTS;
    const current = normalizeHostname(location.hostname);
    const mismatch = Array.isArray(hosts) && hosts.length > 0 && !hosts.some((host) => normalizeHostname(host) === current);
    hostsNotice.hidden = !mismatch || Date.now() < hostsNoticeUntil;
    if (!hostsNotice.hidden) hostsNoticeDescription.textContent = '你正在通过 ' + current + ' 访问。当前节点主机列表为 ' + hosts.join('、') + '；生成的订阅会使用列表中的域名。可在「节点配置 → 节点主机名」核对并保存。';
  }
  const preferences = panel('workspace-preferences', '工作空间外观', '按你的习惯选择显示方式。简洁视图收起其他页面的辅助工具；进阶配置始终展示全部选项。通过进阶页的工具入口可直接打开所需功能。');
  const preferenceGrid = make('div', 'field-grid'); preferences.append(preferenceGrid);
  const viewSelect = field(preferenceGrid, '界面显示', 'view-mode', { value: mode, options: [['full', '完整视图 · 全部设置与工具'], ['simple', '简洁视图 · 常用配置']] });
  viewSelect.addEventListener('change', () => applyMode(viewSelect.value, { expand: true }));
  document.addEventListener('brclio:reveal', (event) => {
    const destination = $(event.detail);
    if (mode === 'simple' && document.body.dataset.page !== 'advanced' && destination?.closest('.advanced-tool')) {
      applyMode('full'); viewSelect.value = mode;
      B.toast('已切换到完整视图，并打开所选工具。');
    }
  });
  const appearance = field(preferenceGrid, '配色主题', 'appearance-mode', { value: theme, options: [['light', '日间 · 暖纸'], ['dark', '夜间 · 墨色']] });
  appearance.addEventListener('change', () => applyTheme(appearance.value));
  $('theme-toggle').addEventListener('click', () => { appearance.value = theme; });

  // ECH explanations complement the editable preset suggestions in the node form.
  const nodeNote = make('details', 'tool-help advanced-tool'); nodeNote.append(make('summary', '', 'ECH、gRPC 与证书选项说明'));
  const notes = make('ul', 'explanation-list');
  for (const text of ['ECH 需要客户端及其 TLS 实现支持；chrome / firefox 指纹是上游推荐的兼容选择。', 'gRPC 需要在域名的 Cloudflare 网络设置启用 gRPC。修改传输协议后请更新客户端订阅。', 'ALPN 留空由客户端协商。跳过证书验证会降低连接验证强度，请根据客户端能力决定。', 'ECH DNS / SNI 字段支持原版预设和自定义输入。实际连通情况需在你的客户端验证。']) notes.append(make('li', '', text));
  nodeNote.append(notes, link('查看 Cloudflare gRPC 文档 ↗', 'https://developers.cloudflare.com/network/grpc-connections/')); $('node-tools').append(nodeNote);

  // Remote address preview / aggregation: no request until the user presses Preview.
  const apiPanel = panel('subscription-tools', '优选接口与订阅汇聚', '验证远程地址接口，预览结果后追加接口地址或当前结果。不会自动改写保存的列表。', { details: true, advanced: true });
  apiPanel.parentElement.id = 'address-api-tool';
  const apiGrid = make('div', 'field-grid'); apiPanel.append(apiGrid);
  const apiURL = field(apiGrid, 'API / 订阅 URL', 'address-api-url', { full: true, placeholder: 'https://… 或 GitHub 文件链接' });
  const apiPort = field(apiGrid, '默认端口', 'address-api-port', { type: 'number', value: '443', min: 1, max: 65535 });
  const apiProxy = field(apiGrid, '将优选作为 PROXYIP', 'address-api-proxyip', { options: [['false', '否'], ['true', '是']] });
  const apiResults = field(apiPanel, '接口返回结果', 'address-api-results', { type: 'textarea' }); apiResults.readOnly = true;
  let preview = null;
  const apiStatus = status(apiPanel, 'address-api-status');
  const appendURL = button('追加接口 URL', 'append-api-url', () => { if (preview) B.appendAddresses(preview.url); });
  const appendResults = button('追加当前结果', 'append-api-results', () => { if (preview) B.appendAddresses(preview.lines); });
  appendURL.disabled = appendResults.disabled = true;
  function invalidatePreview() { preview = null; appendURL.disabled = appendResults.disabled = true; }
  [apiURL, apiPort, apiProxy].forEach((input) => input.addEventListener('input', invalidatePreview));
  const previewButton = button('验证并预览', 'preview-address-api', async () => run(previewButton, apiStatus, async () => {
    const port = Number(apiPort.value); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('默认端口必须是 1–65535 的整数。');
    let url = new URL(apiURL.value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('请输入 HTTP 或 HTTPS URL。');
    if (url.hostname === 'github.com') { const parts = url.pathname.split('/').filter(Boolean); if (parts.length >= 5 && ['blob', 'raw'].includes(parts[2])) url = new URL('https://raw.githubusercontent.com/' + parts.slice(0, 2).join('/') + '/' + parts.slice(3).join('/')); }
    url.searchParams.set('port', String(port)); if (apiProxy.value === 'true') url.searchParams.set('proxyip', 'true'); else url.searchParams.delete('proxyip');
    const response = await B.api('/admin/getADDAPI', { method: 'POST', data: { url: url.href } });
    if (!Array.isArray(response.data) || !response.data.length) throw new Error('接口未返回可用地址。请检查源内容。');
    preview = { url: url.href, lines: response.data.map(String) }; apiResults.value = preview.lines.join('\n'); appendURL.disabled = appendResults.disabled = false;
    showStatus(apiStatus, '已读取 ' + preview.lines.length + ' 条结果。选择追加接口以动态更新，或追加当前结果保留此刻的地址。');
  }), true);
  actions(apiPanel, previewButton, appendURL, appendResults);

  const chainPanel = panel('subscription-tools', '添加链式代理节点', '先验证你自己的上游代理，再生成自定义列表条目；可以为每个节点使用不同出口。', { details: true, advanced: true });
  chainPanel.parentElement.id = 'chain-proxy-tool';
  const chainGrid = make('div', 'field-grid'); chainPanel.append(chainGrid);
  const chainName = field(chainGrid, '节点名称', 'chain-name', { placeholder: '我的链式代理' });
  const chainHost = field(chainGrid, '优选域名 / IP', 'chain-host', { placeholder: '留空使用当前节点域名' });
  const chainPort = field(chainGrid, '优选端口', 'chain-port', { type: 'number', placeholder: '可留空', min: 1, max: 65535 });
  const chainType = field(chainGrid, '代理类型', 'chain-type', { options: ['socks5', 'http', 'https', 'turn', 'sstp'] });
  const chainAddress = field(chainGrid, '代理地址与账号', 'chain-address', { full: true, type: 'password', placeholder: 'user:password@host:port' });
  const chainStatus = status(chainPanel, 'chain-status'); let chainValidated = '';
  const chainAdd = button('追加链式节点', 'append-chain', () => {
    const address = normalizeProxy(chainAddress.value), key = chainType.value + ':' + address;
    if (chainValidated !== key) { showStatus(chainStatus, '代理内容已变化，请重新验证。', true); return; }
    let host = chainHost.value.trim() || B.getConfig()?.HOST || '';
    if (!host || /[\s/#?$]/.test(host)) { showStatus(chainStatus, '请填写有效的优选域名或 IP。', true); return; }
    if ((host.match(/:/g) || []).length > 1 && !host.startsWith('[')) host = '[' + host + ']';
    const port = chainPort.value.trim(); if (port && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) { showStatus(chainStatus, '端口必须是 1–65535 的整数，或留空。', true); return; }
    const name = chainName.value.trim().replace(/[\n\r#$]/g, ' ') || chainType.value.toUpperCase() + ' 链式代理';
    B.appendAddresses(host + (port ? ':' + port : '') + '#' + name + '$' + chainType.value + '://' + address);
  }); chainAdd.disabled = true;
  const chainCheck = button('验证代理可用性', 'verify-chain', async () => run(chainCheck, chainStatus, async () => {
    const address = normalizeProxy(chainAddress.value), type = chainType.value; if (!address) throw new Error('请填写代理地址。');
    const key = type + ':' + address; const response = await B.api('/admin/check', { method: 'POST', data: { type, address } });
    if (key !== chainType.value + ':' + normalizeProxy(chainAddress.value)) throw new Error('代理已修改，请重新验证。');
    chainValidated = key; chainAdd.disabled = false; showStatus(chainStatus, resultDescription(response)); addIPDetailAction(chainStatus, response);
  }), true);
  [chainType, chainAddress].forEach((input) => input.addEventListener('input', () => { chainAdd.disabled = true; chainValidated = ''; }));
  actions(chainPanel, chainCheck, chainAdd);

  // Converter and template catalogues are fetched solely after a click.
  const converterPanel = $('converter-tools');
  const converterStatus = status(converterPanel, 'converter-check-status');
  const converterCheck = button('验证当前转换后端', 'verify-converter', async () => run(converterCheck, converterStatus, async () => {
    const url = B.read(['订阅转换配置', 'SUBAPI']); if (!url) throw new Error('请先填写订阅转换后端。');
    const result = await B.api('/admin/testSubAPI', { method: 'POST', data: { url } });
    if (B.read(['订阅转换配置', 'SUBAPI']) !== url) throw new Error('转换后端地址已变化，请重新验证。');
    if (result.url && result.url !== url) { B.setField(['订阅转换配置', 'SUBAPI'], result.url); showStatus(converterStatus, '转换后端可用：' + (result.version || result.text || result.message || result.url) + '。已将后端地址规范为 ' + result.url + '，请保存主配置。'); }
    else showStatus(converterStatus, '转换后端可用：' + (result.version || result.text || result.message || url));
  }));
  actions(converterPanel, converterCheck);
  function createCatalogPicker(parent, kind, label, onApply) {
    const row = make('div', 'catalog-picker'); const select = make('select', 'field-input'); select.setAttribute('aria-label', label); select.disabled = true;
    const initial = make('option', '', '点击加载后选择预设'); initial.value = ''; select.append(initial);
    const stateNode = status(parent, 'catalog-' + kind + '-status'); let data = [];
    const load = button('加载' + label, 'load-catalog-' + kind, async () => run(load, stateNode, async () => {
      const result = await catalog(kind); data = Array.isArray(result.data) ? result.data : [];
      if (!data.length) throw new Error('来源未返回有效预设。');
      select.replaceChildren(); const choose = make('option', '', '请选择' + label); choose.value = ''; select.append(choose);
      if (kind === 'subconfig') data.forEach((group) => { const options = make('optgroup'); options.label = group.label || '其他'; (group.options || []).forEach((item) => { const option = make('option', '', item.label || item.value); option.value = item.value; options.append(option); }); select.append(options); });
      else data.forEach((item, index) => { const option = make('option', '', kind === 'paths' ? item.项目名 : item.label || item.value); option.value = kind === 'paths' ? String(index) : item.value; select.append(option); });
      select.disabled = false; showStatus(stateNode, '已从 ' + new URL(result.source).hostname + ' 加载。选择后点击应用，不会自动保存。');
    }));
    const apply = button('应用所选', 'apply-catalog-' + kind, () => { if (select.value === '') { B.toast('请先选择一个预设。', true); return; } onApply(kind === 'paths' ? data[Number(select.value)] : select.value); });
    row.append(select, load, apply); parent.append(row);
  }
  createCatalogPicker(converterPanel, 'subapi', '转换后端预设', (value) => replaceConfigField(['订阅转换配置', 'SUBAPI'], value));
  createCatalogPicker(converterPanel, 'subconfig', '转换规则预设', (value) => replaceConfigField(['订阅转换配置', 'SUBCONFIG'], value));
  createCatalogPicker($('template-tools'), 'paths', '路径模板预设', (preset) => {
    if (!preset?.路径模板) { B.toast('模板数据无效。', true); return; }
    const previous = B.read(['反代', '路径模板']) || {};
    const merged = { ...previous };
    for (const [key, value] of Object.entries(preset.路径模板)) merged[key] = typeof value === 'object' && value ? { ...(previous[key] || {}), ...value } : value;
    replaceConfigField(['反代', '路径模板'], merged); if (preset.提示消息) B.toast(String(preset.提示消息));
  });

  const proxyPanel = panel('routing-tools', '手动验证代理出口', '检测由当前 Worker 发起。输入代理地址后点击验证；选择协议或打开页面不会触发检测。', { advanced: true });
  proxyPanel.parentElement.id = 'proxy-check-tool';
  const proxyGrid = make('div', 'field-grid'); proxyPanel.append(proxyGrid);
  const proxyType = field(proxyGrid, '检测协议', 'proxy-check-type', { options: ['proxyip', 'socks5', 'http', 'https', 'turn', 'sstp'] });
  const proxyAddress = field(proxyGrid, '待验证地址', 'proxy-check-address', { type: 'password', placeholder: 'IP:端口 或 user:password@host:port' });
  const proxyStatus = status(proxyPanel, 'proxy-check-status'); let proxyValidated = '';
  const useProxy = button('应用为当前出口', 'use-checked-proxy', () => {
    const type = proxyType.value, address = normalizeProxy(proxyAddress.value);
    if (proxyValidated !== type + ':' + address) { B.toast('地址已经变化，请重新验证。', true); return; }
    if (type === 'proxyip') { B.write(['反代', 'PROXYIP'], address); B.write(['反代', 'SOCKS5', '启用'], null); }
    else { B.write(['反代', 'SOCKS5', '启用'], type); B.write(['反代', 'SOCKS5', '账号'], address); }
    B.renderFields(); B.markChanged(); B.toast('已应用到当前出口，请保存配置。');
  }); useProxy.disabled = true;
  const checkProxy = button('验证可用性', 'verify-proxy', async () => run(checkProxy, proxyStatus, async () => {
    const type = proxyType.value, address = normalizeProxy(proxyAddress.value); if (!address || address === 'auto') throw new Error('请输入要验证的具体地址。');
    const key = type + ':' + address; const result = await B.api('/admin/check', { method: 'POST', data: { type, address } });
    if (key !== proxyType.value + ':' + normalizeProxy(proxyAddress.value)) throw new Error('输入已变化，请重新验证。');
    proxyValidated = key; useProxy.disabled = false; showStatus(proxyStatus, resultDescription(result)); addIPDetailAction(proxyStatus, result);
  }), true);
  const fillProxy = button('填入当前出口', 'fill-current-proxy', () => { const c = B.getConfig(); if (!c) return; proxyType.value = c.反代?.SOCKS5?.启用 || 'proxyip'; proxyAddress.value = proxyType.value === 'proxyip' ? c.反代?.PROXYIP || '' : c.反代?.SOCKS5?.账号 || ''; proxyValidated = ''; useProxy.disabled = true; });
  [proxyType, proxyAddress].forEach((input) => input.addEventListener('input', () => { proxyValidated = ''; useProxy.disabled = true; }));
  actions(proxyPanel, fillProxy, checkProxy, useProxy);

  const libraryPanel = panel('routing-tools', '按地区查找公开代理', '第三方列表可能随时变化。加载后筛选地区，可选择任意候选或整个地区进行手动验证；队列最多 8 并发，随时可以停止。应用出口时，PROXYIP 最多 8 个，其他协议 1 个。', { details: true, advanced: true });
  libraryPanel.parentElement.id = 'proxy-library-tool';
  const libraryGrid = make('div', 'field-grid'); libraryPanel.append(libraryGrid);
  const libraryType = field(libraryGrid, '公开列表类型', 'proxy-library-type', { options: ['proxyip', 'socks5', 'http', 'https'] });
  const libraryRegion = field(libraryGrid, '目标地区', 'proxy-library-region', { options: [['', '全部地区']] });
  const librarySearch = field(libraryGrid, '搜索地址 / 城市 / ASN', 'proxy-library-search', { full: true, type: 'search', placeholder: '输入关键词过滤候选' });
  const libraryStatus = status(libraryPanel, 'proxy-library-status');
  let records = [], loadedType = '', libraryPage = 0, verificationBusy = false, verificationController = null; const selected = new Set();
  const tableWrap = make('div', 'table-wrap proxy-library-table'); const table = make('table', 'data-table'); const head = make('thead'), headingRow = make('tr');
  for (const text of ['选择', '候选地址', '地区与网络', '验证结果']) headingRow.append(make('th', '', text)); head.append(headingRow); const body = make('tbody'); table.append(head, body); tableWrap.append(table); libraryPanel.append(tableWrap);
  const libraryEmpty = make('p', 'empty-inline', '尚未加载第三方列表。'); libraryPanel.append(libraryEmpty);
  const libraryMap = make('div', 'library-map'); libraryPanel.append(libraryMap);
  const libraryPageLabel = make('span', 'field-hint');
  function filterRecords() { const keyword = librarySearch.value.trim().toLowerCase(); return records.filter((item) => (!libraryRegion.value || item.country === libraryRegion.value) && (!keyword || [item.address, item.country, item.city, item.asn, item.organization].join(' ').toLowerCase().includes(keyword))); }
  function renderLibrary() {
    const filtered = filterRecords(); const pageCount = Math.max(1, Math.ceil(filtered.length / 25)); libraryPage = Math.min(libraryPage, pageCount - 1); body.replaceChildren();
    filtered.slice(libraryPage * 25, (libraryPage + 1) * 25).forEach((record) => {
      const row = make('tr'), selectedCell = make('td'), checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(record.address); checkbox.disabled = verificationBusy; checkbox.setAttribute('aria-label', '选择 ' + record.address);
      checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(record.address); else selected.delete(record.address); updateLibraryButtons(); });
      selectedCell.append(checkbox); const address = make('td'); address.append(make('span', '', record.address));
      const place = make('td', '', (record.country || '未知地区') + ' · ' + (record.city || '—')); place.append(make('small', '', (record.asn ? 'AS' + record.asn + ' ' : '') + record.organization));
      const result = make('td', '', record.pending ? '正在验证…' : record.result?.success ? (record.result.responseTime ?? '—') + ' ms · 可用' : record.error || '尚未检测');
      if (record.result?.ip) result.append(button('IP 详情', null, () => showIPDetail(record.result.ip)));
      row.append(selectedCell, address, place, result); body.append(row);
    });
    libraryEmpty.hidden = filtered.length > 0; libraryEmpty.textContent = records.length ? '没有匹配的候选，请调整筛选条件。' : '尚未加载第三方列表。';
    libraryPageLabel.textContent = '共 ' + filtered.length + ' 个候选 · 第 ' + (libraryPage + 1) + '/' + pageCount + ' 页';
    libraryMap.replaceChildren(); const mapped = filtered.slice(libraryPage * 25, (libraryPage + 1) * 25).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    if (mapped.length) libraryMap.append(locationMap(mapped.map((item) => ({ ...item, label: item.address })), '本页 ' + mapped.length + ' 个候选的位置（列表来源提供）'));
    previous.disabled = libraryPage === 0; next.disabled = libraryPage >= pageCount - 1; updateLibraryButtons();
  }
  function updateLibraryButtons() {
    verifySelected.disabled = verificationBusy || !selected.size || loadedType !== libraryType.value;
    useSelected.disabled = verificationBusy || !selected.size || selected.size > (loadedType === 'proxyip' ? 8 : 1) || !records.filter((item) => selected.has(item.address)).every((item) => item.result?.success);
    selectionCount.textContent = '已选 ' + selected.size + ' 个候选';
    [selectFiltered, invertFiltered, clearSelection].forEach((item) => { item.disabled = verificationBusy || !records.length; });
    stopVerification.disabled = !verificationBusy;
  }
  const previous = button('上一页', 'proxy-library-previous', () => { libraryPage--; renderLibrary(); });
  const next = button('下一页', 'proxy-library-next', () => { libraryPage++; renderLibrary(); }); actions(libraryPanel, libraryPageLabel, previous, next);
  const loadLibrary = button('加载第三方列表', 'load-proxy-library', async () => run(loadLibrary, libraryStatus, async () => {
    const kind = libraryType.value, response = await catalog(kind); let list = Array.isArray(response.data) ? response.data : response.data?.data;
    if (!Array.isArray(list)) throw new Error('第三方来源格式无法识别。');
    if (kind === 'proxyip') list = list.filter((item) => Array.isArray(item.port) ? item.port.includes(443) : item.port === 443);
    const coordinate = (value) => value === null || value === undefined || value === '' ? NaN : Number(value);
    records = list.map((item) => { const meta = item.meta || item; return { address: normalizeProxy(item.proxy || item.ip || ''), country: meta.country_cn || meta.country || '未知', city: meta.city || '', asn: meta.asn || '', organization: meta.asOrganization || '', latitude: coordinate(meta.latitude ?? meta.colo?.lat), longitude: coordinate(meta.longitude ?? meta.colo?.lon) }; }).filter((item) => item.address);
    loadedType = kind; libraryPage = 0; selected.clear(); libraryRegion.replaceChildren(); const all = make('option', '', '全部地区'); all.value = ''; libraryRegion.append(all);
    [...new Set(records.map((item) => item.country))].sort().forEach((country) => { const option = make('option', '', country); option.value = country; libraryRegion.append(option); });
    showStatus(libraryStatus, '已读取 ' + records.length + ' 个候选。来源：' + response.source + '。请选择候选后手动验证。'); renderLibrary();
  }), true);
  const verifySelected = button('验证所选候选', 'verify-proxy-selection', async () => run(verifySelected, libraryStatus, async () => {
    const items = records.filter((item) => selected.has(item.address)); const type = loadedType;
    verificationController = new AbortController(); const controller = verificationController; let cursor = 0, completed = 0;
    verificationBusy = true; libraryType.disabled = loadLibrary.disabled = true; renderLibrary();
    try {
      const worker = async () => {
        while (cursor < items.length && !controller.signal.aborted) {
          const item = items[cursor++]; item.pending = true; renderLibrary();
          try {
            const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) : controller.signal;
            item.result = await B.api('/admin/check', { method: 'POST', data: { type, address: item.address }, signal }); item.error = '';
          } catch (error) { item.result = null; item.error = controller.signal.aborted ? '已停止' : error.message; }
          finally { item.pending = false; completed++; showStatus(libraryStatus, (controller.signal.aborted ? '正在停止' : '手动验证中') + '：' + completed + ' / ' + items.length + '，最多 8 并发。'); renderLibrary(); }
        }
      };
      await Promise.allSettled(Array.from({ length: Math.min(8, items.length) }, worker));
      records.sort((a, b) => a.result?.success && b.result?.success ? (Number(a.result.responseTime) || 0) - (Number(b.result.responseTime) || 0) : a.result?.success ? -1 : b.result?.success ? 1 : 0);
      showStatus(libraryStatus, (controller.signal.aborted ? '已停止验证' : '手动验证完成') + '：处理 ' + completed + '/' + items.length + ' 个，' + items.filter((item) => item.result?.success).length + ' 个可用。结果已按可用性与响应时间排序。');
    } finally { verificationBusy = false; verificationController = null; libraryType.disabled = loadLibrary.disabled = false; renderLibrary(); }
  }));
  const useSelected = button('应用所选出口', 'apply-proxy-selection', () => {
    const items = records.filter((item) => selected.has(item.address)); if (!items.length || items.some((item) => !item.result?.success)) return;
    if (items.length > (loadedType === 'proxyip' ? 8 : 1)) { B.toast(loadedType === 'proxyip' ? '应用时最多选择 8 个 PROXYIP。' : '应用时请选择 1 个代理出口。', true); return; }
    if (loadedType === 'proxyip') { B.write(['反代', 'PROXYIP'], items.map((item) => item.address).join(',')); B.write(['反代', 'SOCKS5', '启用'], null); }
    else { B.write(['反代', 'SOCKS5', '启用'], loadedType); B.write(['反代', 'SOCKS5', '账号'], items[0].address); }
    B.renderFields(); B.markChanged(); B.toast('已填入 ' + items.length + ' 个出口，请保存主配置。');
  });
  const stopVerification = button('停止验证', 'stop-proxy-verification', () => { verificationController?.abort(); });
  const selectionCount = make('span', 'field-hint', '已选 0 个候选');
  const selectFiltered = button('选择当前筛选全部', 'select-filtered-proxies', () => { filterRecords().forEach((item) => selected.add(item.address)); renderLibrary(); });
  const invertFiltered = button('反选当前筛选', 'invert-filtered-proxies', () => { filterRecords().forEach((item) => { if (selected.has(item.address)) selected.delete(item.address); else selected.add(item.address); }); renderLibrary(); });
  const clearSelection = button('清除选择', 'clear-proxy-selection', () => { selected.clear(); renderLibrary(); });
  actions(libraryPanel, selectionCount, selectFiltered, invertFiltered, clearSelection);
  actions(libraryPanel, loadLibrary, verifySelected, stopVerification, useSelected); verifySelected.disabled = useSelected.disabled = previous.disabled = next.disabled = stopVerification.disabled = selectFiltered.disabled = invertFiltered.disabled = clearSelection.disabled = true;
  document.addEventListener('brclio:navigate', (event) => { if (event.detail !== 'routing' && verificationController) verificationController.abort(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && verificationController) verificationController.abort(); });
  libraryRegion.addEventListener('change', () => { libraryPage = 0; renderLibrary(); }); librarySearch.addEventListener('input', () => { libraryPage = 0; renderLibrary(); }); libraryType.addEventListener('change', () => { selected.clear(); records = []; loadedType = ''; libraryPage = 0; renderLibrary(); showStatus(libraryStatus, '列表类型已切换，点击「加载第三方列表」获取候选。'); });

  // The original local optimizer is a catalogue of independent projects, not embedded executable code.
  const localTarget = make('div'); localTarget.id = 'local-tools-catalog'; $('page-speedtest').append(localTarget);
  const localPanel = panel('local-tools-catalog', '本地测速工具目录', '在自己的电脑上运行独立测速工具。点击加载后查看上游维护的项目目录，按界面类型筛选，再前往各项目阅读安装说明。', { details: true });
  const localToolbar = make('div', 'field-grid'); localPanel.append(localToolbar);
  const localFilter = field(localToolbar, '工具界面', 'local-tool-filter', { options: [['all', '全部类型'], ['webui', '网页界面 Web UI'], ['gui', '图形界面 GUI'], ['cli', '命令行 CLI']] });
  const localSearch = field(localToolbar, '搜索工具', 'local-tool-search', { type: 'search', placeholder: '项目名称、作者、平台…' });
  const localStatus = status(localPanel, 'local-tool-status'), localList = make('div', 'local-tool-list'); localPanel.append(localList);
  localList.append(make('p', 'empty-inline', '尚未加载工具目录。打开页面不会请求第三方来源。'));
  let localProjects = [];
  const uiLabels = { webui: '网页界面', gui: '图形界面', cli: '命令行' };
  function renderLocalTools() {
    const query = localSearch.value.trim().toLowerCase();
    const projects = localProjects.filter((project) => (localFilter.value === 'all' || (project.ui || []).some((value) => String(value).toLowerCase() === localFilter.value)) && (!query || [project.name, project.author, project.description, ...(project.platforms || [])].join(' ').toLowerCase().includes(query)));
    localList.replaceChildren();
    if (!projects.length) { localList.append(make('p', 'empty-inline', localProjects.length ? '没有匹配的工具，请调整筛选条件。' : '目录暂时没有工具条目。')); return; }
    projects.forEach((project) => {
      const item = make('article', 'local-tool-item'), heading = make('div', 'local-tool-heading');
      const title = make('h3', '', project.name || '未命名工具'); heading.append(title);
      const stars = Number(project.stars); if (Number.isFinite(stars) && stars > 0) heading.append(make('span', 'field-hint', stars.toLocaleString('zh-CN') + ' stars（目录快照）'));
      item.append(heading); if (project.author) item.append(make('p', 'field-hint', '作者：' + project.author));
      item.append(make('p', 'local-tool-description', project.description || '请前往项目查看说明。'));
      const tags = make('div', 'ip-flags');
      for (const value of project.ui || []) tags.append(make('span', 'outline-tag', uiLabels[String(value).toLowerCase()] || String(value)));
      for (const value of project.platforms || []) tags.append(make('span', 'outline-tag', String(value)));
      item.append(tags);
      try { const destination = new URL(project.url); if (!['https:', 'http:'].includes(destination.protocol)) throw new Error(); item.append(link('前往工具项目 ↗', destination.href)); }
      catch { item.append(make('p', 'field-hint', '目录未提供有效项目地址。')); }
      localList.append(item);
    });
  }
  const loadLocalTools = button('加载本地工具目录', 'load-local-tools', async () => run(loadLocalTools, localStatus, async () => {
    const result = await catalog('localtools');
    if (!Array.isArray(result.data?.projects)) throw new Error('工具目录未返回有效的 projects 数组。');
    localProjects = result.data.projects.filter((project) => project && typeof project === 'object').map((project) => ({ ...project, ui: Array.isArray(project.ui) ? project.ui : [], platforms: Array.isArray(project.platforms) ? project.platforms : [] })).sort((a, b) => (Number(b.stars) || 0) - (Number(a.stars) || 0));
    renderLocalTools(); showStatus(localStatus, '已加载 ' + localProjects.length + ' 个独立项目。来源：' + result.source + '。代码、安装要求与许可由各项目自行说明。');
  }), true);
  actions(localPanel, loadLocalTools, link('查看目录来源 ↗', 'https://raw.githubusercontent.com/cmliu/cmliu/refs/heads/main/json/best-cf-tools.json'));
  localFilter.addEventListener('change', renderLocalTools); localSearch.addEventListener('input', renderLocalTools);

  // Usage and Bot verification use stored credentials through same-origin POST endpoints.
  const usagePanel = $('usage-tools'); const usageSummary = make('div', 'usage-summary'); const usageText = make('strong', '', '尚未接入请求量统计'); const usageProgress = make('progress'); usageProgress.max = 100; usageProgress.value = 0; usageProgress.setAttribute('aria-label', '今日请求配额使用比例'); const usageDetail = make('p', 'field-hint'); const countdown = make('p', 'field-hint'); usageSummary.append(usageText, usageProgress, usageDetail, countdown); usagePanel.append(usageSummary);
  const usageStatus = status(usagePanel, 'usage-check-status');
  function renderUsage() {
    const usage = B.getConfig()?.CF?.Usage;
    if (usage?.success) { const total = Number(usage.total) || 0, max = Number(usage.max) || 100000; usageText.textContent = total.toLocaleString('zh-CN') + ' / ' + max.toLocaleString('zh-CN') + ' 次 · ' + (total / max * 100).toFixed(2) + '%'; usageProgress.value = Math.min(100, total / max * 100); usageDetail.textContent = 'Workers ' + (Number(usage.workers) || 0).toLocaleString('zh-CN') + ' · Pages ' + (Number(usage.pages) || 0).toLocaleString('zh-CN'); }
    else { usageText.textContent = '尚未取得有效请求量'; usageProgress.value = 0; usageDetail.textContent = '先保存一组 Cloudflare 凭据，再点击验证与刷新。'; }
  }
  function updateCountdown() { const now = new Date(), reset = new Date(now); reset.setUTCHours(24, 0, 0, 0); const seconds = Math.floor((reset - now) / 1000); countdown.textContent = '距下一个 UTC 日界线 ' + Math.floor(seconds / 3600) + ' 时 ' + Math.floor(seconds % 3600 / 60) + ' 分；实际配额以 Cloudflare 控制台为准。'; }
  const refreshUsage = button('验证并刷新用量', 'verify-cloudflare-usage', async () => run(refreshUsage, usageStatus, async () => { const usage = await B.api('/admin/getCloudflareUsage'); B.setUsage(usage); renderUsage(); showStatus(usageStatus, '已使用保存的凭据查询最新用量。'); }));
  actions(usagePanel, refreshUsage); updateCountdown(); setInterval(updateCountdown, 60000);
  const telegramStatus = status($('telegram-tools'), 'telegram-test-status');
  const testTelegram = button('发送一条测试消息', 'test-telegram', async () => {
    if (!await B.confirmAction('发送 Telegram 测试消息？', '使用已保存的 Bot Token 和 Chat ID，向该聊天发送一条配置验证消息。不会开启后续自动通知。', '发送测试消息')) return;
    return run(testTelegram, telegramStatus, async () => { const result = await B.api('/admin/testTelegram', { method: 'POST', data: { sendMessage: true } }); showStatus(telegramStatus, '测试消息已发送。' + (result.username ? ' Bot：@' + result.username : '')); });
  }); actions($('telegram-tools'), testTelegram);

  const projectPanel = panel('project-tools', '版本与开源项目', '查看运行中的版本，获取这份 Brclio Worker 的完整源码和 Pages 安装包。', { details: true });
  const versionSummary = make('p', 'field-hint'); projectPanel.append(versionSummary); const versionStatus = status(projectPanel, 'version-check-status');
  const checkVersion = button('手动检查上游版本', 'check-upstream-version', async () => run(checkVersion, versionStatus, async () => { const result = await catalog('version'); const version = result.data?.version ?? result.data; showStatus(versionStatus, '当前集成上游版本：' + (B.getMeta()?.upstreamVersion || '未知') + '；官方最新源码标识：' + String(version) + '。请先阅读变更记录，升级需要重新构建部署。'); }));
  const changelog = make('details', 'tool-help upstream-changelog'); changelog.id = 'upstream-changelog';
  changelog.append(make('summary', '', '上游更新日志内容'));
  const changelogText = make('pre', 'changelog-content', '点击「查看上游更新日志」后加载。'); changelog.append(changelogText);
  const changelogSource = make('p', 'field-hint'); changelog.append(changelogSource);
  const changelogStatus = status(projectPanel, 'upstream-changelog-status');
  const readChangelog = button('查看上游更新日志', 'read-upstream-changelog', async () => run(readChangelog, changelogStatus, async () => {
    const result = await B.api('/admin/upstream-changelog');
    if (typeof result.content !== 'string' || !result.content.trim()) throw new Error('上游没有返回可显示的更新日志，请重试。');
    changelogText.textContent = result.content; changelogSource.textContent = result.source ? '来源：' + result.source : '';
    changelog.open = true; showStatus(changelogStatus, '上游更新日志已加载。可再次点击刷新。');
  }));
  projectPanel.append(changelog);
  const copyWorker = button('复制当前 Worker 源码', 'copy-worker-source', async () => run(copyWorker, versionStatus, async () => { const source = await B.api('/admin/download/worker.js', { text: true }); await B.copy(source); showStatus(versionStatus, '已取得当前部署的 Brclio Worker 源码。'); }));
  const downloadWorker = make('a', 'button button-small', '下载 Worker.js'); downloadWorker.href = '/admin/download/worker.js'; downloadWorker.download = 'brclio-edge-worker.js';
  const downloadPages = make('a', 'button button-small', '下载 Pages ZIP'); downloadPages.href = '/admin/download/pages.zip'; downloadPages.download = 'brclio-edge-pages.zip';
  actions(projectPanel, checkVersion, readChangelog, copyWorker, downloadWorker, downloadPages);
  const projectLinks = make('div', 'tool-actions'); projectLinks.append(link('本项目提交记录 ↗', 'https://github.com/Brclio/brclio-cloudflare-tz/commits/main/'), link('上游更新记录 ↗', 'https://github.com/cmliu/edgetunnel/commits/main/'), link('第三方 Snippets 工具 ↗', 'https://github.com/EDT-Pages/EDT.min.js/tree/Snippets'), link('JShaman 第三方代码工具 ↗', 'https://www.jshaman.com/')); projectPanel.append(projectLinks);
  projectPanel.append(make('p', 'field-hint', 'Snippets 属于第三方独立项目，使用其自身源码和许可。这里保留项目入口；Brclio Worker 下载包含本项目全部开源界面。'));
  projectPanel.append(make('p', 'field-hint', 'JShaman 是外部代码处理服务。此入口只打开其网站，不会上传源码、配置或任何凭据。'));
  window.addEventListener('brclio:config', () => { renderUsage(); renderHostsNotice(); const meta = B.getMeta(); versionSummary.textContent = 'Brclio Edge ' + (meta?.version || '—') + ' · 集成上游 ' + (meta?.upstreamVersion || '—'); });
  renderUsage(); renderHostsNotice();
  applyMode(mode, { expand: true });
  window.BrclioTools = { showQR };
})();
