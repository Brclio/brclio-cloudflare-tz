// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Each request owns its dial settings. Never let a previous request's carrier
// or environment change the connection strategy of another active tunnel.
function concurrency(value, fallback) {
  const count = Number(value);
  // Workers permits six concurrent pending outbound connections. Values above
  // that only queue more work; non-finite values must not allocate dial arrays.
  return Number.isFinite(count) && count > 0 ? Math.min(6, Math.max(1, Math.floor(count))) : fallback;
}

export function dialSettings(env = {}, carrier = 'cf') {
  return Object.freeze({
    tcpConcurrency: concurrency(env.TCP_CONCURRENT_DIAL, carrier === 'cmcc' ? 1 : 2),
    proxyConcurrency: concurrency(env.PROXY_CONCURRENT_DIAL, 1),
    preloadRace: ['1', 'true'].includes(env.PRELOAD_RACE_DIAL),
  });
}

export async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
