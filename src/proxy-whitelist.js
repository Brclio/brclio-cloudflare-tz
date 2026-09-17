// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Tunnel requests only need routing policy; do not load management settings,
// usage endpoints, notifications, or write defaults while accepting a tunnel.
export const DEFAULT_PROXY_WHITELIST = Object.freeze([
  '*tapecontent.net', '*cloudatacdn.com', '*loadshare.org', '*cdn-centaurus.com', 'scholar.google.com',
]);

function mergeWhitelist(entries, env) {
  const forced = typeof env.GO2SOCKS5 === 'string' ? env.GO2SOCKS5.split(/[\t"'\r\n,]+/) : [];
  return [...new Set([...entries, ...forced].filter(entry => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean))];
}

export function defaultProxyWhitelist(env = {}) {
  return mergeWhitelist(DEFAULT_PROXY_WHITELIST, env);
}

export async function loadProxyWhitelist(env = {}) {
  let entries = DEFAULT_PROXY_WHITELIST;
  if (typeof env.KV?.get === 'function') {
    try {
      const stored = await env.KV.get('config.json');
      const saved = stored ? JSON.parse(stored)?.反代?.SOCKS5?.白名单 : undefined;
      // A saved empty list deliberately disables the built-in matches.
      if (Array.isArray(saved) && saved.every(entry => typeof entry === 'string')) entries = saved;
    } catch {
      // Missing, malformed, or temporarily unavailable legacy configuration
      // retains the previous defaults plus the environment's forced entries.
    }
  }
  return mergeWhitelist(entries, env);
}

export function matchesProxyWhitelist(host, entries) {
  return entries.some(pattern => {
    // Only '*' is a wildcard; dots, brackets and every other regex character
    // are literal so saved hostnames cannot broaden matches or throw errors.
    const source = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`, 'i').test(host);
  });
}
