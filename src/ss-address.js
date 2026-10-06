// Copyright (C) 2026 Brclio. GPL-2.0-only.
// An authenticated AEAD record is a stream chunk, not an address boundary.
const decoder = new TextDecoder();
const more = Object.freeze({ status: 'need_more' });

export function createShadowsocksAddressParser() {
  let pending = new Uint8Array(0), finished = false;
  return {
    push(chunk) {
      if (finished) return { status: 'invalid', message: 'SS address already completed' };
      if (!(chunk instanceof Uint8Array)) throw new TypeError('SS address chunks must be Uint8Array');
      let bytes = chunk;
      if (pending.length) {
        bytes = new Uint8Array(pending.length + chunk.length);
        bytes.set(pending);
        bytes.set(chunk, pending.length);
      }
      let cursor = 1, hostname = '', end;
      if (!bytes.length) return more;
      const type = bytes[0];
      if (type === 1) end = 5;
      else if (type === 4) end = 17;
      else if (type === 3) {
        if (bytes.length < 2) { pending = bytes.slice(); return more; }
        cursor = 2;
        if (!bytes[1]) { finished = true; return { status: 'invalid', message: 'Empty SS hostname' }; }
        end = cursor + bytes[1];
      } else {
        finished = true;
        return { status: 'invalid', message: 'Invalid SS address type' };
      }
      if (bytes.length < end + 2) {
        // The longest unfinished address is 258 bytes (255-byte domain).
        pending = bytes.slice();
        return more;
      }
      if (type === 1) hostname = Array.from(bytes.subarray(cursor, end)).join('.');
      else if (type === 3) hostname = decoder.decode(bytes.subarray(cursor, end));
      else {
        const parts = [];
        for (let index = cursor; index < end; index += 2) parts.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
        hostname = parts.join(':');
      }
      pending = new Uint8Array(0);
      finished = true;
      return { status: 'ok', hostname, port: (bytes[end] << 8) | bytes[end + 1], rawData: bytes.subarray(end + 2) };
    },
  };
}
