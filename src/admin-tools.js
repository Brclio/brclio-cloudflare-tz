// Copyright (C) 2026 Brclio. GPL-2.0-only.
// The Worker calls this module only after authenticating the administrator and
// enforcing same-origin writes. No network operation runs on module import.

const CATALOGS = Object.freeze({
  subapi: 'https://raw.githubusercontent.com/cmliu/cmliu/main/SUBAPI.json',
  subconfig: 'https://raw.githubusercontent.com/cmliu/cmliu/main/SUBCONFIG.json',
  paths: 'https://raw.githubusercontent.com/cmliu/cmliu/main/json/edt-path-config.json',
  localtools: 'https://raw.githubusercontent.com/cmliu/cmliu/refs/heads/main/json/best-cf-tools.json',
  socks5: 'https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/socks5.json',
  http: 'https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/http.json',
  https: 'https://raw.githubusercontent.com/EDT-Pages/Proxy-List/main/data/https.json',
  proxyip: 'https://zip.cm.edu.kg.cmliussss.net/all.json',
  version: 'https://raw.githubusercontent.com/cmliu/edgetunnel/main/_worker.js',
});
const TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
class ToolError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function readLimited(response, limit) {
  if (Number(response.headers.get('Content-Length')) > limit) throw new ToolError('响应内容超过大小限制', 502);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      size += chunk.value.byteLength;
      if (size > limit) throw new ToolError('响应内容超过大小限制', 502);
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function remoteText(url, options = {}, maxBytes = MAX_RESPONSE_BYTES, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ToolError('远端服务响应超时，请稍后重试', 504));
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      // Only explicitly constructed headers are forwarded, never browser cookies.
      const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new ToolError(`远端服务返回 HTTP ${response.status}`, 502);
      return readLimited(response, maxBytes);
    })()]);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    // Fetch errors can contain URLs (including Telegram credentials).
    throw new ToolError(controller.signal.aborted ? '远端服务响应超时，请稍后重试' : '无法连接远端服务，请稍后重试', controller.signal.aborted ? 504 : 502);
  } finally { clearTimeout(timer); }
}

function parseRemoteJSON(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new ToolError('远端服务返回了无效 JSON', 502); }
  if (!data || typeof data !== 'object') throw new ToolError('远端服务返回的数据格式无效', 502);
  return data;
}

async function readInput(request) {
  let input;
  try { input = JSON.parse(await readLimited(request, 8192)); }
  catch { throw new ToolError('请提交不超过 8 KiB 的有效 JSON 对象'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolError('请提交 JSON 对象');
  return input;
}

function converterOrigin(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input.trim())) throw new ToolError('订阅转换地址无效或过长');
  let url;
  try { url = new URL(input.includes('://') ? input : `https://${input}`); }
  catch { throw new ToolError('订阅转换地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ToolError('订阅转换地址须为 HTTP(S)，且不能包含用户名或密码');
  return url.origin;
}

async function catalog(request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  if (!Object.hasOwn(CATALOGS, kind || '') || [...params.keys()].some(key => key !== 'kind')) throw new ToolError('目录类型无效');
  const source = CATALOGS[kind];
  // The upstream ProxyIP catalogue contains about 15,000 records / 13 MiB.
  const text = await remoteText(source, {}, kind === 'proxyip' ? 20 * 1024 * 1024 : MAX_RESPONSE_BYTES, kind === 'proxyip' ? 15000 : TIMEOUT_MS);
  let data;
  if (kind === 'version') {
    const match = text.match(/^\s*const\s+Version\s*=\s*['"]([^'"\r\n]{1,80})['"]/m);
    if (!match) throw new ToolError('未能从上游源码识别版本', 502);
    data = { version: match[1] };
  } else data = parseRemoteJSON(text);
  return json({ success: true, kind, source, data });
}

async function testSubAPI(input) {
  const url = converterOrigin(input.url);
  const version = (await remoteText(`${url}/version`, { method: 'GET' }, 8192)).trim();
  if (!version.toLowerCase().includes('subconverter')) throw new ToolError('远端响应不包含 subconverter 版本标识', 502);
  return json({ success: true, url, version });
}

async function testTelegram(input, env) {
  if (input.sendMessage !== true) throw new ToolError('测试通知需要明确设置 sendMessage: true');
  let credentials;
  try { credentials = JSON.parse(await env.KV.get('tg.json')); }
  catch { throw new ToolError('请先保存有效的 Telegram 通知配置'); }
  const { BotToken, ChatID } = credentials || {};
  if (typeof BotToken !== 'string' || !/^\d{1,20}:[A-Za-z0-9_-]{1,200}$/.test(BotToken) || !['string', 'number'].includes(typeof ChatID) || !String(ChatID).trim() || String(ChatID).length > 256) {
    throw new ToolError('请先保存有效的 Telegram Bot Token 和 Chat ID');
  }
  const endpoint = `https://api.telegram.org/bot${BotToken}`;
  const bot = parseRemoteJSON(await remoteText(`${endpoint}/getMe`, { method: 'POST' }, 65536));
  if (bot.ok !== true || !bot.result?.is_bot) throw new ToolError('Telegram Bot Token 验证失败', 502);
  const sent = parseRemoteJSON(await remoteText(`${endpoint}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(ChatID), text: '✅ Brclio Edge：Telegram 通知配置已验证成功！' }),
  }, 65536));
  if (sent.ok !== true) throw new ToolError('Telegram 测试消息发送失败，请检查 Chat ID 和机器人权限', 502);
  const username = typeof bot.result.username === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(bot.result.username) ? bot.result.username : undefined;
  return json({ success: true, sent: true, username, message: 'Telegram 测试消息已发送' });
}

async function checkProxyIP(input) {
  const address = input.address;
  if (typeof address !== 'string' || address.length > 512 || !/^[A-Za-z0-9.:[\]_-]+$/.test(address)) throw new ToolError('ProxyIP 地址无效，请填写域名、IP 或地址:端口');
  const url = new URL('https://api.090227.xyz/check');
  url.searchParams.set('proxyip', address);
  const data = parseRemoteJSON(await remoteText(url.href, {}, 65536));
  if (typeof data.success !== 'boolean') throw new ToolError('ProxyIP 检测接口返回的数据格式无效', 502);
  const result = { success: data.success, supports_ipv4: data.supports_ipv4 === true, supports_ipv6: data.supports_ipv6 === true };
  for (const key of ['ip', 'loc']) if (typeof data[key] === 'string' && data[key].length <= 128 && !/[\u0000-\u001f\u007f]/.test(data[key])) result[key] = data[key];
  if (typeof data.responseTime === 'number' && Number.isFinite(data.responseTime) && data.responseTime >= 0) result.responseTime = data.responseTime;
  if (!data.success) result.error = 'ProxyIP 检测未通过';
  return json(result);
}

async function ipDetail(input) {
  const ip = input.ip;
  if (typeof ip !== 'string' || ip.length > 45) throw new ToolError('请输入有效的 IPv4 或 IPv6 地址');
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(part => Number(part) <= 255 && (part.length === 1 || !part.startsWith('0')));
  let ipv6 = false;
  if (ip.includes(':') && /^[A-Fa-f0-9:.]+$/.test(ip)) {
    try { ipv6 = new URL(`http://[${ip}]/`).hostname.startsWith('['); } catch { /* invalid IPv6 */ }
  }
  if (!ipv4 && !ipv6) throw new ToolError('请输入有效的 IPv4 或 IPv6 地址');
  const source = 'https://api.ipapi.is/';
  const url = new URL(source);
  url.searchParams.set('q', ip);
  const data = parseRemoteJSON(await remoteText(url.href, {}, 1024 * 1024));
  if (typeof data.ip !== 'string' || data.error) throw new ToolError('IP 信息服务未返回有效查询结果', 502);
  return json({ success: true, source, data });
}

/** Return null for paths / proxy types handled by the tunnel Worker. */
export async function handleAdminTool(request, env, toolPath) {
  const path = '/' + toolPath.replace(/^\/+/, '').split('?')[0];
  if (!['/admin/catalog', '/admin/testSubAPI', '/admin/testTelegram', '/admin/check', '/admin/ipDetail'].includes(path)) return null;
  if (path === '/admin/check' && request.method !== 'POST') return null;
  try {
    const method = path === '/admin/catalog' ? 'GET' : 'POST';
    if (request.method !== method) return json({ success: false, error: `此接口仅支持 ${method}` }, 405);
    if (path === '/admin/catalog') return await catalog(request);
    // The main Worker still needs the original body for other proxy protocols.
    const input = await readInput(path === '/admin/check' ? request.clone() : request);
    if (path === '/admin/testSubAPI') return await testSubAPI(input);
    if (path === '/admin/testTelegram') return await testTelegram(input, env);
    if (path === '/admin/ipDetail') return await ipDetail(input);
    return input.type === 'proxyip' ? await checkProxyIP(input) : null;
  } catch (error) {
    return json({ success: false, error: error instanceof ToolError ? error.message : '工具请求失败，请检查配置后重试' }, error instanceof ToolError ? error.status : 500);
  }
}
