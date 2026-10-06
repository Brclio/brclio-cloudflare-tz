// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Only DNS-over-TCP framing is handled here. This does not provide arbitrary UDP.
export const MAX_DNS_MESSAGE_BYTES = 65535;
export const DNS_QUERY_TIMEOUT_MS = 5000;

const bytes = value => value instanceof Uint8Array ? value : new Uint8Array(value);
const failure = signal => signal?.reason instanceof Error ? signal.reason : new Error('DNS query cancelled');

export function encodeDNSFrame(payload) {
  payload = bytes(payload);
  if (!payload.length || payload.length > MAX_DNS_MESSAGE_BYTES) throw new Error('Invalid DNS message length');
  const frame = new Uint8Array(payload.length + 2);
  frame[0] = payload.length >>> 8;
  frame[1] = payload.length & 255;
  frame.set(payload, 2);
  return frame;
}

export function createDNSFrameParser() {
  let frame = new Uint8Array(2), used = 0, expected = 2;
  return {
    push(value) {
      const input = bytes(value), frames = [];
      let offset = 0;
      while (offset < input.length) {
        const count = Math.min(expected - used, input.length - offset);
        frame.set(input.subarray(offset, offset + count), used);
        used += count; offset += count;
        if (used !== expected) continue;
        if (expected === 2) {
          const length = (frame[0] << 8) | frame[1];
          if (!length) throw new Error('Invalid DNS message length');
          expected = length + 2;
          const next = new Uint8Array(expected);
          next.set(frame); frame = next;
        } else {
          frames.push(frame);
          frame = new Uint8Array(2); used = 0; expected = 2;
        }
      }
      return frames;
    },
    finish() { if (used) throw new Error('Truncated DNS frame'); },
    clear() { frame = new Uint8Array(2); used = 0; expected = 2; },
    get bufferedBytes() { return used; },
  };
}

export function createTrojanUDPParser() {
  // At most 263 header bytes and 65535 payload bytes can be retained.
  let header = new Uint8Array(263), used = 0, headerLength = null, frame = null;
  function reset() { used = 0; headerLength = null; frame = null; }
  return {
    push(value) {
      const input = bytes(value), packets = [];
      let offset = 0;
      while (offset < input.length) {
        if (!frame) {
          header[used++] = input[offset++];
          const type = header[0];
          if (![1, 3, 4].includes(type)) throw new Error('Invalid Trojan UDP address type');
          if (type === 3 && used < 2) continue;
          if (type === 3 && !header[1]) throw new Error('Invalid Trojan UDP domain length');
          headerLength = 1 + (type === 1 ? 4 : type === 4 ? 16 : 1 + header[1]) + 6;
          if (used < headerLength) continue;
          if (header[headerLength - 2] !== 13 || header[headerLength - 1] !== 10) throw new Error('Invalid Trojan UDP delimiter');
          const port = (header[headerLength - 6] << 8) | header[headerLength - 5];
          if (port !== 53) throw new Error('UDP is not supported');
          const length = (header[headerLength - 4] << 8) | header[headerLength - 3];
          if (!length) throw new Error('Invalid DNS message length');
          frame = new Uint8Array(headerLength + length);
          frame.set(header.subarray(0, headerLength));
        }
        const count = Math.min(frame.length - used, input.length - offset);
        frame.set(input.subarray(offset, offset + count), used);
        used += count; offset += count;
        if (used === frame.length) {
          packets.push({ addressPort: frame.slice(0, headerLength - 4), payload: frame.slice(headerLength) });
          reset();
        }
      }
      return packets;
    },
    finish() { if (used) throw new Error('Truncated Trojan UDP frame'); },
    clear: reset,
    get bufferedBytes() { return used; },
  };
}

export function encodeTrojanUDPResponse(addressPort, dnsFrame) {
  const frame = new Uint8Array(addressPort.length + dnsFrame.length + 2);
  frame.set(addressPort);
  frame.set(dnsFrame.subarray(0, 2), addressPort.length);
  frame.set([13, 10], addressPort.length + 2);
  frame.set(dnsFrame.subarray(2), addressPort.length + 4);
  return frame;
}

// A resolver may keep TCP open for more queries. Return at the DNS length
// boundary, then close our one-query socket; never wait for the peer's EOF.
export async function exchangeDNSFrame(frame, connect, { signal, timeoutMs = DNS_QUERY_TIMEOUT_MS } = {}) {
  if (signal?.aborted) throw failure(signal);
  let socket, reader, writer, timer, onAbort, stopped;
  const release = () => {
    try { reader?.releaseLock(); } catch {}
    try { writer?.releaseLock(); } catch {}
  };
  const close = reason => {
    if (reason) stopped ||= reason;
    try { Promise.resolve(socket?.close()).catch(() => {}); } catch {}
    if (reason) {
      try { Promise.resolve(reader?.cancel(reason)).catch(() => {}); } catch {}
      try { Promise.resolve(writer?.abort(reason)).catch(() => {}); } catch {}
    }
  };
  const interruption = new Promise((_, reject) => {
    const interrupt = error => { close(error); reject(error); };
    timer = setTimeout(() => interrupt(new Error('DNS query timed out')), timeoutMs);
    onAbort = () => interrupt(failure(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  const task = (async () => {
    socket = connect({ hostname: '8.8.4.4', port: 53 });
    socket.closed?.catch(() => {});
    if (socket.opened) await socket.opened;
    if (stopped) throw stopped;
    if (signal?.aborted) throw failure(signal);
    writer = socket.writable.getWriter();
    await writer.write(frame);
    if (stopped) throw stopped;
    writer.releaseLock(); writer = null;
    reader = socket.readable.getReader();
    const parser = createDNSFrameParser();
    while (true) {
      const { done, value } = await reader.read();
      if (stopped) throw stopped;
      if (done) { parser.finish(); throw new Error('DNS resolver closed without a response'); }
      const frames = parser.push(value);
      if (frames.length) return frames[0];
    }
  })();
  // Also release pending stream locks after timeout/abort settles the operation.
  task.then(release, release);
  try { return await Promise.race([task, interruption]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    close();
    release();
  }
}
