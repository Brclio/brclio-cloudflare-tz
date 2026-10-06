// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Each request owns its dial settings. Never let a previous request's carrier
// or environment change the connection strategy of another active tunnel.
function concurrency(value, fallback) {
  const count = Number(value);
  // Workers permits six concurrent pending outbound connections. Values above
  // that only queue more work; non-finite values must not allocate dial arrays.
  return Number.isFinite(count) && count > 0 ? Math.min(6, Math.max(1, Math.floor(count))) : fallback;
}

function deadline(value, fallback, minimum, maximum) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0
    ? Math.min(maximum, Math.max(minimum, Math.floor(duration))) : fallback;
}

export function dialSettings(env = {}, carrier = 'cf') {
  return Object.freeze({
    tcpConcurrency: concurrency(env.TCP_CONCURRENT_DIAL, carrier === 'cmcc' ? 1 : 2),
    proxyConcurrency: concurrency(env.PROXY_CONCURRENT_DIAL, 1),
    preloadRace: ['1', 'true'].includes(env.PRELOAD_RACE_DIAL),
    connectTimeoutMs: deadline(env.CONNECT_TIMEOUT_MS, 3000, 250, 15000),
    proxyHandshakeTimeoutMs: deadline(env.PROXY_HANDSHAKE_TIMEOUT_MS, 10000, 1000, 60000),
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

// A fresh TCP connection cannot resume an arbitrary partially sent stream.
// Only replay the initial TLS hello or a complete bodyless safe HTTP request.
export function canReplayInitialData(data) {
  if (!data?.byteLength) return true;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length >= 6 && bytes[0] === 22 && bytes[1] === 3 && bytes[2] <= 4 && bytes[5] === 1
    && bytes.length === 5 + ((bytes[3] << 8) | bytes[4])) return true;
  if (bytes.length > 16384) return false;
  const text = new TextDecoder().decode(bytes);
  return /^(?:GET|HEAD|OPTIONS) [^\r\n]+ HTTP\/1\.[01]\r\n/.test(text)
    && text.endsWith('\r\n\r\n') && text.indexOf('\r\n\r\n') === text.length - 4
    && !/\r\ntransfer-encoding\s*:/i.test(text)
    && [...text.matchAll(/\r\ncontent-length\s*:\s*([^\r\n]*)/gi)].every(match => match[1].trim() === '0');
}
