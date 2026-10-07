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
export const MAX_INITIAL_TLS_BYTES = 16384 + 5;

function isCompleteClientHello(bytes) {
  if (bytes.length < 50 || bytes.length > MAX_INITIAL_TLS_BYTES || bytes[0] !== 22
    || bytes[1] !== 3 || bytes[2] > 3 || bytes[5] !== 1
    || bytes.length !== 5 + ((bytes[3] << 8) | bytes[4])
    || bytes.length !== 9 + ((bytes[6] << 16) | (bytes[7] << 8) | bytes[8])
    || bytes[9] !== 3 || bytes[10] > 3) return false;
  // ClientHello's vectors must end at the handshake boundary. Merely seeing a
  // handshake record/type byte is insufficient to exclude malformed records.
  let offset = 43;
  const sessionLength = bytes[offset++];
  if (sessionLength > 32 || offset + sessionLength + 2 > bytes.length) return false;
  offset += sessionLength;
  const cipherLength = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
  if (cipherLength < 2 || cipherLength % 2 || offset + cipherLength + 1 > bytes.length) return false;
  offset += cipherLength;
  const compressionLength = bytes[offset++];
  if (!compressionLength || offset + compressionLength > bytes.length) return false;
  offset += compressionLength;
  if (offset === bytes.length) return true; // Older TLS without extensions.
  if (offset + 2 > bytes.length) return false;
  const extensionsLength = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
  if (offset + extensionsLength !== bytes.length) return false;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) return false;
    const type = (bytes[offset] << 8) | bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]; offset += 4;
    // An early_data offer may be followed by application records in another
    // tunnel message. Conservatively reject the offer itself, before they arrive.
    if (type === 42 || offset + length > bytes.length) return false;
    offset += length;
  }
  return true;
}

export function canReplayInitialData(data) {
  if (!data?.byteLength) return true;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (isCompleteClientHello(bytes)) return true;
  if (bytes.length > 16384) return false;
  const text = new TextDecoder().decode(bytes);
  return /^(?:GET|HEAD|OPTIONS) [^\r\n]+ HTTP\/1\.[01]\r\n/.test(text)
    && text.endsWith('\r\n\r\n') && text.indexOf('\r\n\r\n') === text.length - 4
    && !/\r\ntransfer-encoding\s*:/i.test(text)
    && [...text.matchAll(/\r\ncontent-length\s*:\s*([^\r\n]*)/gi)].every(match => match[1].trim() === '0');
}

// Tunnel-message boundaries need not match a TLS record. Keep only the first
// possible ClientHello, and discard it permanently after any subsequent bytes.
export function createInitialReplayTracker(initialData = null) {
  let storage = null, used = 0, complete = false, disabled = false;
  const stop = () => { disabled = true; complete = false; storage = null; used = 0; };
  const append = data => {
    if (!data?.byteLength) return !disabled;
    if (disabled || complete || used + data.byteLength > MAX_INITIAL_TLS_BYTES) { stop(); return false; }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    // Allocate once: byte-by-byte tunnel fragmentation must not cause quadratic copying.
    storage ||= new Uint8Array(MAX_INITIAL_TLS_BYTES);
    storage.set(bytes, used); used += bytes.length;
    if (storage[0] !== 22 || (used >= 2 && storage[1] !== 3)
      || (used >= 3 && storage[2] > 3)) { stop(); return false; }
    if (used >= 5) {
      const expected = 5 + ((storage[3] << 8) | storage[4]);
      if (expected > MAX_INITIAL_TLS_BYTES || expected < 50 || used > expected) { stop(); return false; }
      if (used === expected) {
        if (!isCompleteClientHello(storage.subarray(0, used))) { stop(); return false; }
        complete = true;
      }
    }
    return true;
  };
  if (initialData?.byteLength && initialData[0] !== 22 && canReplayInitialData(initialData)) {
    storage = new Uint8Array(initialData); used = storage.length; complete = true;
  } else append(initialData);
  return {
    append, stop,
    get data() { return storage?.subarray(0, used) || new Uint8Array(0); },
    get replayable() { return !disabled && (!used || complete); },
    get bufferedBytes() { return used; },
  };
}
