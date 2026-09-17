/* SPDX-License-Identifier: GPL-2.0-only · Original Brclio Edge usage panel */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const format = (n) => new Intl.NumberFormat('zh-CN').format(n);
  function usageModel(cf = {}, sampledAt = null, now = Date.now()) {
    const u = cf?.Usage;
    const configured = Boolean(cf?.APIToken || cf?.GlobalAPIKey || cf?.UsageAPI);
    const valid = u?.success === true && ['workers', 'pages', 'total', 'max'].every(k => Number.isFinite(u[k]) && u[k] >= 0) && u.max > 0 && u.total === u.workers + u.pages;
    const stale = valid && sampledAt !== null && Math.floor(sampledAt / DAY) !== Math.floor(now / DAY);
    const resetAt = (Math.floor(now / DAY) + 1) * DAY;
    const seconds = Math.max(0, Math.ceil((resetAt - now) / 1000));
    const widths = valid ? [u.workers, u.pages].map(n => n / Math.max(u.max, u.total) * 100) : [0, 0];
    return { configured, valid, stale, resetAt, seconds, widths, custom: Boolean(cf?.UsageAPI),
      percent: valid ? u.total / u.max * 100 : null,
      remaining: valid ? Math.max(0, u.max - u.total) : null,
      level: !valid ? 'unknown' : u.total >= u.max ? 'exceeded' : u.total >= u.max * .8 ? 'warning' : 'normal' };
  }
  function countdownText(seconds) { return Math.floor(seconds / 3600) + ' 小时 ' + Math.floor(seconds % 3600 / 60) + ' 分 ' + seconds % 60 + ' 秒'; }
  root.BrclioUsage = { usageModel, countdownText };
  if (!root.document) return;
  const B = root.BrclioUI;
  const widgets = [];
  let sampledAt = null, refreshing = false, error = '', controller = null, generation = 0, renderedDay = Math.floor(Date.now() / DAY);
  function element(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
  function mount(id, overview) {
    const host = document.getElementById(id);
    if (!host) return;
    const panel = element(overview ? 'details' : 'section', 'usage-panel' + (overview ? '' : ' usage-panel-compact'));
    panel.id = overview ? 'request-usage-panel' : 'settings-usage-panel';
    const header = element(overview ? 'summary' : 'div', 'usage-heading');
    const heading = element('div'); heading.append(element('span', 'small-caps', 'WORKERS & PAGES'), element(overview ? 'h2' : 'h3', '', 'Workers/Pages 请求使用情况'));
    const badge = element('span', 'outline-tag', '正在读取'); header.append(heading, badge);
    if (overview) {
      panel.open = true;
      try { panel.open = localStorage.getItem('brclio-usage-collapsed') !== '1'; } catch { /* Storage is optional. */ }
      header.append(element('span', 'usage-chevron', '⌄'));
      panel.addEventListener('toggle', () => { try { localStorage.setItem('brclio-usage-collapsed', panel.open ? '0' : '1'); } catch { /* Storage is optional. */ } });
    }
    const body = element('div', 'usage-body');
    const topline = element('div', 'usage-topline');
    const totalWrap = element('div'); const totalLabel = element('span', 'field-hint', '今日请求总计'); const total = element('strong', 'usage-total', '—'); totalWrap.append(totalLabel, total);
    const percent = element('span', 'usage-percentage', '等待查询'); topline.append(totalWrap, percent);
    const bar = element('div', 'usage-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Workers 与 Pages 请求使用比例'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
    const workerBar = element('span', 'usage-bar-workers'); const pagesBar = element('span', 'usage-bar-pages'); bar.append(workerBar, pagesBar);
    const counts = element('dl', 'usage-counts'); const values = [];
    ['Workers 请求', 'Pages 请求', '日配额'].forEach((label, index) => { const col = element('div', ['usage-workers', 'usage-pages', 'usage-limit'][index]); const value = element('dd', '', '—'); values.push(value); col.append(element('dt', '', label), value); counts.append(col); });
    const message = element('p', 'usage-message'); message.setAttribute('role', 'status');
    const reset = element('p', 'usage-reset'); const timer = element('strong'); reset.append(element('span', '', '距离每日重置 '), timer, element('span', '', ' · 北京时间（UTC+8）08:00 / UTC 00:00'));
    const scope = element('p', 'field-hint usage-scope');
    const actions = element('div', 'usage-actions');
    const refresh = element('button', 'button button-small', overview ? '刷新用量' : '验证并刷新用量'); refresh.type = 'button'; refresh.id = overview ? 'refresh-overview-usage' : 'verify-cloudflare-usage'; refresh.addEventListener('click', refreshUsage);
    const setup = element('a', 'text-link', overview ? '配置用量查询 ↗' : 'Cloudflare 查询凭据说明 ↗');
    if (overview) { setup.href = '#settings'; setup.addEventListener('click', () => { B.navigate('settings'); document.getElementById('cf-form').scrollIntoView({ block: 'center' }); document.getElementById('cf-AccountID').focus({ preventScroll: true }); }); }
    else { setup.href = 'https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/'; setup.target = '_blank'; setup.rel = 'noopener noreferrer'; }
    const updated = element('span', 'field-hint'); actions.append(refresh, setup, updated);
    body.append(topline, bar, counts, message, reset, scope, actions); panel.append(header, body); host.append(panel);
    widgets.push({ panel, badge, totalLabel, total, percent, bar, workerBar, pagesBar, values, message, timer, scope, refresh, updated });
  }
  function render() {
    renderedDay = Math.floor(Date.now() / DAY);
    const cf = B.getConfig()?.CF || {}, u = cf.Usage, model = usageModel(cf, sampledAt);
    for (const w of widgets) {
      w.panel.dataset.level = model.level;
      w.panel.setAttribute('aria-busy', String(refreshing));
      w.badge.textContent = refreshing ? '正在查询' : error ? '查询失败' : model.stale ? '待刷新' : model.valid ? '已连接' : model.configured ? '查询失败' : '未配置';
      w.totalLabel.textContent = model.stale ? '上次查询总计（已跨日）' : '今日请求总计';
      w.total.textContent = model.valid ? format(u.total) : '—';
      w.percent.textContent = model.valid ? model.percent.toFixed(2) + '% 已使用' : '等待有效用量';
      w.workerBar.style.width = model.widths[0] + '%'; w.pagesBar.style.width = model.widths[1] + '%';
      if (model.valid) { w.bar.setAttribute('aria-valuenow', String(Math.min(100, model.percent))); w.bar.setAttribute('aria-valuetext', (model.stale ? '上次查询：' : '') + 'Workers ' + format(u.workers) + '，Pages ' + format(u.pages) + '，使用 ' + model.percent.toFixed(2) + '%'); }
      else { w.bar.removeAttribute('aria-valuenow'); w.bar.setAttribute('aria-valuetext', '尚未取得有效用量'); }
      [u?.workers, u?.pages, u?.max].forEach((n, i) => { w.values[i].textContent = model.valid ? format(n) : '—'; });
      w.values[2].previousSibling.textContent = model.custom ? '日配额（自定义 API）' : '日配额（免费方案参考）';
      w.message.classList.toggle('is-error', Boolean(error) || !model.valid && model.configured);
      w.message.textContent = refreshing ? '正在使用已保存的凭据查询；期间保留上次数据。' : error ? '本次查询失败：' + error + (model.valid ? ' 下方更新时间对应上次成功结果。' : ' 请检查已保存凭据及查询权限后重试。') : model.stale ? '已进入新的 UTC 日期，请刷新用量。上次结果不会自动当作今天的数据或清零。' : !model.valid ? model.configured ? '已配置查询，但未取得有效用量。请检查凭据、账户权限或自定义 API，点击刷新重试。' : '尚未配置用量查询。保存一组 Cloudflare 凭据后，即可查看实际请求数量。' : model.level === 'exceeded' ? '已达到日配额参考值' + (u.total > u.max ? '，超出 ' + format(u.total - u.max) + ' 次。' : '。') + '实际限制以账户方案为准。' : '剩余 ' + format(model.remaining) + ' 次' + (model.level === 'warning' ? '，已使用超过或等于 80%。' : '。');
      w.timer.textContent = countdownText(model.seconds);
      w.scope.textContent = model.custom ? '数据与配额来自你配置的自定义 API；下方倒计时采用 Cloudflare 的 UTC 日界线，请确认该 API 使用相同统计周期。' : '统计所选账户自 UTC 00:00 起的 Workers 与 Pages Functions 请求，不只统计当前项目；静态资源请求不计入此配额。100,000 次为免费方案参考值，未读取付费方案额度。';
      w.refresh.disabled = refreshing || !B.getConfig() || (!model.configured && !model.valid);
      w.updated.textContent = sampledAt === null ? '尚无成功查询' : '更新于 ' + new Date(sampledAt).toLocaleString('zh-CN', { hour12: false });
    }
    const metric = document.getElementById('metric-usage'), detail = document.getElementById('metric-usage-detail');
    if (metric) metric.textContent = model.valid ? format(u.total) : model.configured ? '查询失败' : '未配置';
    if (detail) detail.textContent = model.stale ? '已跨日，请刷新用量' : error ? '刷新失败 · 详见用量面板' : model.valid ? 'Workers ' + format(u.workers) + ' · Pages ' + format(u.pages) : model.configured ? '检查凭据或重新查询' : '可在设置中连接用量查询';
  }
  function invalidate() { generation++; controller?.abort(); controller = null; refreshing = false; error = ''; sampledAt = null; }
  async function refreshUsage() {
    if (refreshing || !B.getConfig()) return;
    const version = generation, requestedAt = Date.now(); const requestController = new AbortController(); controller = requestController; refreshing = true; error = ''; render();
    const timeout = setTimeout(() => requestController.abort(), 20000);
    try {
      const usage = await B.api('/admin/getCloudflareUsage', { signal: requestController.signal });
      if (version !== generation) return;
      if (!usageModel({ Usage: usage }).valid) throw new Error('服务器没有返回有效用量。');
      B.setUsage(usage, requestedAt);
    } catch (e) { if (version === generation) error = e.message; }
    finally { clearTimeout(timeout); if (version === generation) { refreshing = false; controller = null; render(); } }
  }
  function receive(event) {
    if (event.detail?.preserveUsage) { render(); return; }
    invalidate();
    if (usageModel(B.getConfig()?.CF).valid) sampledAt = event.detail?.requestedAt ?? Date.now();
    render();
  }
  Object.assign(root.BrclioUsage, { render, refresh: refreshUsage, credentialsChanged() { invalidate(); render(); return refreshUsage(); }, clear() { invalidate(); render(); } });
  mount('overview-usage', true); mount('usage-tools', false);
  root.addEventListener('brclio:config', receive);
  root.addEventListener('brclio:usage', event => { sampledAt = event.detail?.sampledAt ?? Date.now(); error = ''; render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  // The clock only updates local text. It never schedules a network query.
  setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    if (Math.floor(now / DAY) !== renderedDay) { render(); return; }
    const text = countdownText(Math.ceil(((renderedDay + 1) * DAY - now) / 1000));
    for (const w of widgets) {
      if (w.panel.closest('.page')?.hidden || w.panel.tagName === 'DETAILS' && !w.panel.open) continue;
      if (w.timer.textContent !== text) w.timer.textContent = text;
    }
  }, 1000);
  render();
})(globalThis);
