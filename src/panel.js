// Copyright (C) 2026 Brclio. GPL-2.0-only.
import assets from 'brclio:assets';

const encoder = new TextEncoder();
const SESSION_SECONDS = 86400;
const attempts = new Map(); // Best-effort per-isolate throttle; not a global rate limiter.
export const panelHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...panelHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
export function localAsset(path, status = 200) {
  const asset = assets[path];
  if (!asset) return json({ error: '页面不存在' }, 404);
  const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
  return new Response(bytes, { status, headers: { ...panelHeaders, 'Content-Type': asset.type } });
}
export function redirect(path) {
  return new Response(null, { status: 302, headers: { ...panelHeaders, Location: path } });
}
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return (!origin || origin === new URL(request.url).origin) && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}
function sessionValue(request) {
  return (request.headers.get('Cookie') || '').split(';').map(c => c.trim()).find(c => c.startsWith('auth='))?.slice(5) || '';
}
async function signingKey(password, secret) {
  return crypto.subtle.importKey('raw', encoder.encode(`${secret}\u0000${password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function sign(payload, password, secret) {
  return hex(await crypto.subtle.sign('HMAC', await signingKey(password, secret), encoder.encode(payload)));
}
export async function authenticated(request, env, password, secret) {
  try {
    const token = sessionValue(request);
    const [expires, nonce, signature, extra] = token.split('.');
    const now = Math.floor(Date.now() / 1000);
    if (extra || !/^\d{10}$/.test(expires) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false;
    if (+expires <= now || +expires > now + SESSION_SECONDS + 60) return false;
    const bytes = Uint8Array.from(signature.match(/../g), v => parseInt(v, 16));
    const payload = `${expires}.${nonce}.${request.headers.get('User-Agent') || 'null'}`;
    if (!await crypto.subtle.verify('HMAC', await signingKey(password, secret), bytes, encoder.encode(payload))) return false;
    return !(await env.KV.get(`session-revoked:${nonce}`));
  } catch { return false; }
}
function cookie(request, value, age) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  return `auth=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${local && new URL(request.url).protocol === 'http:' ? '' : '; Secure'}`;
}
export async function login(request, env, password, secret) {
  if (request.method === 'GET') return await authenticated(request, env, password, secret) ? redirect('/admin') : localAsset('/login.html');
  if (request.method !== 'POST') return json({ error: '仅支持 GET 或 POST' }, 405, { Allow: 'GET, POST' });
  if (!sameOrigin(request)) return json({ error: '请从本站登录页面提交' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const now = Date.now();
  const previous = attempts.get(ip);
  if (previous && previous.until > now && previous.count >= 10) return json({ error: '尝试次数较多，请 5 分钟后再试' }, 429, { 'Retry-After': '300' });
  const body = await request.text();
  if (body.length > 4096) return json({ error: '输入内容过长' }, 413);
  const supplied = new URLSearchParams(body).get('password') || '';
  const [a, b] = await Promise.all([sign('password-check', supplied, secret), sign('password-check', String(password).replace(/[\r\n]/g, ''), secret)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (difference) {
    if (attempts.size > 1000) for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (attempts.size > 2000) attempts.delete(attempts.keys().next().value);
    attempts.set(ip, { count: previous && previous.until > now ? previous.count + 1 : 1, until: now + 300000 });
    return json({ error: '密码不正确，请重新输入' }, 401);
  }
  attempts.delete(ip);
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const signature = await sign(`${expires}.${nonce}.${request.headers.get('User-Agent') || 'null'}`, password, secret);
  return json({ success: true }, 200, { 'Set-Cookie': cookie(request, `${expires}.${nonce}.${signature}`, SESSION_SECONDS) });
}
export async function logout(request, env, password, secret) {
  if (!sameOrigin(request)) return json({ error: '来源不匹配' }, 403);
  if (await authenticated(request, env, password, secret)) {
    const [expires, nonce] = sessionValue(request).split('.');
    await env.KV.put(`session-revoked:${nonce}`, '1', { expirationTtl: Math.max(60, +expires - Math.floor(Date.now() / 1000)) });
  }
  return new Response(null, { status: 302, headers: { ...panelHeaders, Location: '/login', 'Set-Cookie': cookie(request, '', 0) } });
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mergeConfig(defaults, saved) {
  const result = structuredClone(defaults);
  if (!isObject(saved)) return result;
  for (const [key, value] of Object.entries(saved)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    if (isObject(defaults[key])) result[key] = mergeConfig(defaults[key], value);
    else result[key] = value;
  }
  return result;
}
export function validateConfig(config) {
  if (!isObject(config) || typeof config.UUID !== 'string' || typeof config.HOST !== 'string') return '配置必须包含 UUID 和 HOST';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(config.UUID)) return 'UUID 必须为 UUID v4';
  if (!['vless', 'trojan', 'ss'].includes(config.协议类型)) return '不支持的节点协议';
  if (!['ws', 'grpc', 'xhttp'].includes(config.传输协议)) return '不支持的传输协议';
  if (typeof config.PATH !== 'string' || !config.PATH.startsWith('/') || config.PATH.length > 2048) return 'PATH 必须是 / 开头且不超过 2048 字符的路径';
  for (const path of ['优选订阅生成', '订阅转换配置', '反代', 'TG', 'SS', 'ECHConfig']) if (!isObject(config[path])) return `缺少配置对象：${path}`;
  if (!isObject(config.反代.SOCKS5) || !isObject(config.反代.路径模板) || !isObject(config.优选订阅生成.本地IP库)) return '缺少反代或本地 IP 库配置';
  // Upstream replaces * with random characters when emitting subscriptions.
  // Keep that supported host syntax, including hosts supplied by env.HOST.
  if (!Array.isArray(config.HOSTS) || !config.HOSTS.length || config.HOSTS.some(h => typeof h !== 'string' || !/^[a-z0-9*.-]+$/i.test(h))) return 'HOSTS 必须为有效域名数组（可含 *，不含协议、端口）';
  const pool = config.优选订阅生成.本地IP库;
  if (!Number.isInteger(pool.随机数量) || pool.随机数量 < 1 || pool.随机数量 > 100) return '随机节点数量必须为 1–100 的整数';
  if (pool.指定端口 !== -1 && (!Number.isInteger(pool.指定端口) || pool.指定端口 < 1 || pool.指定端口 > 65535)) return '端口必须为 1–65535 的整数，或 -1 表示随机';
  if (!Number.isFinite(config.优选订阅生成.SUBUpdateTime) || config.优选订阅生成.SUBUpdateTime <= 0) return '订阅更新间隔必须为大于 0 的数值';
  if (typeof config.反代.PROXYIP !== 'string' || !Array.isArray(config.反代.SOCKS5.白名单)) return 'ProxyIP 必须是文字，代理白名单必须是数组';
  if (typeof config.反代.SOCKS5.账号 !== 'string' || config.反代.SOCKS5.白名单.some(host => typeof host !== 'string')) return '代理账号和白名单条目必须为文字';
  if (config.反代.SOCKS5.启用 !== null && !['socks5', 'http', 'https', 'turn', 'sstp'].includes(String(config.反代.SOCKS5.启用).toLowerCase())) return '不支持的链式代理协议';
  const templates = config.反代.路径模板;
  if (typeof templates.PROXYIP !== 'string') return 'PROXYIP 路径模板必须为文字';
  for (const protocol of ['SOCKS5', 'HTTP', 'HTTPS', 'TURN', 'SSTP']) {
    if (!isObject(templates[protocol]) || typeof templates[protocol].全局 !== 'string' || typeof templates[protocol].标准 !== 'string') return `${protocol} 的全局与标准路径模板必须为文字`;
  }
  const booleans = [
    ...['跳过证书验证', '启用0RTT', '随机路径', 'ECH'].map(key => [key, config[key]]),
    ['TG.启用', config.TG.启用], ['SS.TLS', config.SS.TLS],
    ['优选订阅生成.local', config.优选订阅生成.local], ['本地IP库.随机IP', pool.随机IP],
    ['反代.SOCKS5.全局', config.反代.SOCKS5.全局],
    ...['SUBEMOJI', 'SUBLIST', 'UDP', 'XUDP', 'TLS13', 'APPEND_TYPE', 'SORT', 'EXPAND'].map(key => [`订阅转换配置.${key}`, config.订阅转换配置[key]]),
  ];
  for (const [key, value] of booleans) if (typeof value !== 'boolean') return `${key} 必须为 true 或 false`;
  if (!['aes-128-gcm', 'aes-256-gcm'].includes(config.SS.加密方式)) return 'Shadowsocks 仅支持 aes-128-gcm 或 aes-256-gcm';
  if (!['gun', 'multi'].includes(config.gRPC模式)) return 'gRPC 模式必须为 gun 或 multi';
  if (![null, 'Shadowrocket', 'Happ'].includes(config.TLS分片)) return '不支持的 TLS 分片模式';
  if (config.协议类型 === 'ss' && config.传输协议 !== 'ws') return 'Shadowsocks 仅支持 WebSocket 传输';
  if (config.订阅转换配置.XUDP && !config.订阅转换配置.UDP) return '启用 XUDP 时需要同时启用 UDP';
  if (config.启用0RTT && (config.协议类型 === 'ss' || config.传输协议 === 'grpc')) return 'Shadowsocks 和 gRPC 不支持 0-RTT';
  if (config.协议类型 === 'ss' && !config.SS.TLS && (config.ECH || config.TLS分片)) return 'Shadowsocks 关闭 TLS 时不能启用 ECH 或 TLS 分片';
  for (const key of ['ALPN', 'Fingerprint', 'gRPCUserAgent']) if (typeof config[key] !== 'string') return `${key} 必须为文字`;
  if (typeof config.优选订阅生成.SUBNAME !== 'string') return '订阅名称必须为文字';
  const source = config.优选订阅生成.SUB;
  if (source !== null && typeof source !== 'string') return '优选生成器地址必须为文字或 null';
  if (!config.优选订阅生成.local && !source?.trim()) return '使用外部优选生成器时必须填写来源地址';
  for (const key of ['SUBAPI', 'SUBCONFIG']) {
    try {
      if (typeof config.订阅转换配置[key] !== 'string' || !['http:', 'https:'].includes(new URL(config.订阅转换配置[key]).protocol)) throw Error();
    } catch { return `${key} 必须为 HTTP 或 HTTPS URL`; }
  }
  if (typeof config.ECHConfig.DNS !== 'string' || typeof config.ECHConfig.SNI !== 'string') return 'ECH 的 DNS 与 SNI 必须为文字';
  if (JSON.stringify(config).length > 256 * 1024) return '配置超过 256 KiB';
  return null;
}
export async function saveCredentials(request, env, kind) {
  let input;
  try { input = await request.json(); } catch { return json({ error: '请输入有效 JSON' }, 400); }
  if (!isObject(input)) return json({ error: '凭据必须为对象' }, 400);
  const fields = kind === 'cf' ? ['Email', 'GlobalAPIKey', 'AccountID', 'APIToken', 'UsageAPI'] : ['BotToken', 'ChatID'];
  const saved = JSON.parse(await env.KV.get(`${kind}.json`) || '{}');
  const value = Object.fromEntries(fields.map(key => [key, input.init === true ? null : saved[key] ?? null]));
  if (input.init !== true) {
    for (const key of fields) if (input[key] != null && input[key] !== '') {
      if (typeof input[key] !== 'string' || input[key].includes('***') || input[key].length > 4096) return json({ error: `${key} 必须为实际值，不能使用掩码或超长值` }, 400);
      value[key] = input[key];
    }
    if (kind === 'cf') {
      if (input.UsageAPI) { value.Email = value.GlobalAPIKey = value.AccountID = value.APIToken = null; }
      else if (input.APIToken || input.AccountID) { value.Email = value.GlobalAPIKey = value.UsageAPI = null; }
      else if (input.Email || input.GlobalAPIKey) { value.AccountID = value.APIToken = value.UsageAPI = null; }
      if (!(value.Email && value.GlobalAPIKey) && !(value.AccountID && value.APIToken) && !value.UsageAPI) return json({ error: '请填写完整的一组 Cloudflare 凭据' }, 400);
      if (value.UsageAPI) { try { if (new URL(value.UsageAPI).protocol !== 'https:') throw Error(); } catch { return json({ error: 'UsageAPI 必须是 HTTPS URL' }, 400); } }
    } else if (!value.BotToken || !value.ChatID) return json({ error: '请填写 BotToken 和 ChatID' }, 400);
  }
  await env.KV.put(`${kind}.json`, JSON.stringify(value));
  return json({ success: true, message: input.init === true ? '凭据已清除' : '凭据已保存' });
}
export function safeLogURL(raw) {
  const url = new URL(raw);
  // URLs may contain tokens, UUIDs or proxy credentials. Log only the route class.
  return `${url.origin}${url.pathname.startsWith('/admin') ? '/admin' : url.pathname === '/sub' ? '/sub' : '/[redacted]'}`;
}
