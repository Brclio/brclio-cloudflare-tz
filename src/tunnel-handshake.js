// Copyright (C) 2026 Brclio. GPL-2.0-only.
// WS messages and gRPC Hunks are transport chunks, not protocol boundaries.
// Parse one authenticated VLESS/Trojan header, then pass application bytes on.
export const MAX_TUNNEL_HEADER_BYTES = 533; // VLESS: maximum options + domain.
export const MAX_TROJAN_HEADER_BYTES = 320; // SHA224, command, maximum domain, port, delimiters.
const decoder = new TextDecoder();

function matchesPrefix(bytes, offset, expected) {
  for (let index = offset; index < Math.min(bytes.length, offset + expected.length); index++) {
    if (bytes[index] !== expected[index - offset]) return false;
  }
  return true;
}

function credentials(uuidBytes, trojanHash) {
  if (!(uuidBytes instanceof Uint8Array) || uuidBytes.length !== 16) throw new Error('Invalid tunnel UUID');
  if (!/^[0-9a-f]{56}$/.test(trojanHash)) throw new Error('Invalid Trojan credential');
  return { uuid: uuidBytes, trojan: new TextEncoder().encode(trojanHash + '\r\n') };
}

// A short early-data prefix is retained until later transport chunks can
// authenticate it. Ordinary WS subprotocol names such as "binary" do not match.
export function isPossibleTunnelPrefix(bytes, uuidBytes, trojanHash) {
  if (!bytes?.length) return false;
  const expected = credentials(uuidBytes, trojanHash);
  return (bytes.length === 1 ? bytes[0] === 0 : matchesPrefix(bytes, 1, expected.uuid))
    || matchesPrefix(bytes, 0, expected.trojan);
}

const more = Object.freeze({ status: 'need_more' });
const invalid = message => ({ status: 'invalid', message });

function address(bytes, start, type, ipv4Type, domainType, ipv6Type) {
  if (type === ipv4Type) {
    if (bytes.length < start + 4) return more;
    return { hostname: Array.from(bytes.subarray(start, start + 4)).join('.'), end: start + 4 };
  }
  if (type === domainType) {
    if (bytes.length <= start) return more;
    const length = bytes[start++];
    if (!length) return invalid('Empty destination hostname');
    if (bytes.length < start + length) return more;
    return { hostname: decoder.decode(bytes.subarray(start, start + length)), end: start + length };
  }
  if (type === ipv6Type) {
    if (bytes.length < start + 16) return more;
    const parts = [];
    for (let index = start; index < start + 16; index += 2) parts.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
    return { hostname: parts.join(':'), end: start + 16 };
  }
  return invalid('Unsupported destination address type');
}

function parse(bytes, expected) {
  const possibleVless = matchesPrefix(bytes, 1, expected.uuid);
  const possibleTrojan = matchesPrefix(bytes, 0, expected.trojan);
  if (!possibleVless && !possibleTrojan) return invalid('Invalid tunnel credential');

  // A complete matching UUID identifies VLESS even when application data at
  // offsets 56/57 happens to contain CRLF (for example a normal HTTP request).
  if (possibleVless && bytes.length >= 17) {
    if (bytes.length < 18) return more;
    const commandIndex = 18 + bytes[17];
    if (bytes.length <= commandIndex) return more;
    const command = bytes[commandIndex];
    if (command !== 1 && command !== 2) return invalid('Unsupported VLESS command');
    if (bytes.length < commandIndex + 4) return more;
    const port = (bytes[commandIndex + 1] << 8) | bytes[commandIndex + 2];
    const destination = address(bytes, commandIndex + 4, bytes[commandIndex + 3], 1, 2, 3);
    if (destination.status) return destination;
    return {
      status: 'ok', protocol: 'vless', hostname: destination.hostname, port,
      isUDP: command === 2, rawData: bytes.subarray(destination.end),
      responseHeader: new Uint8Array([bytes[0], 0]), originalData: bytes,
    };
  }

  if (!possibleTrojan || bytes.length < 58) return more;
  if (bytes.length < 60) return more;
  const command = bytes[58];
  if (command !== 1 && command !== 3) return invalid('Unsupported Trojan command');
  const destination = address(bytes, 60, bytes[59], 1, 3, 4);
  if (destination.status) return destination;
  if (bytes.length < destination.end + 4) return more;
  if (bytes[destination.end + 2] !== 13 || bytes[destination.end + 3] !== 10) return invalid('Invalid Trojan request delimiter');
  return {
    status: 'ok', protocol: 'trojan', hostname: destination.hostname,
    port: (bytes[destination.end] << 8) | bytes[destination.end + 1],
    isUDP: command === 3, rawData: bytes.subarray(destination.end + 4),
    responseHeader: null, originalData: bytes,
  };
}

export function createTunnelHandshakeParser(uuidBytes, trojanHash) {
  const expected = credentials(uuidBytes, trojanHash);
  let pending = new Uint8Array(0), finished = false;
  return {
    push(chunk) {
      if (finished) return invalid('Tunnel handshake already completed');
      if (!(chunk instanceof Uint8Array)) throw new TypeError('Tunnel chunks must be Uint8Array');
      let bytes = chunk;
      if (pending.length) {
        bytes = new Uint8Array(pending.length + chunk.length);
        bytes.set(pending);
        bytes.set(chunk, pending.length);
      }
      const result = parse(bytes, expected);
      if (result.status === 'need_more') {
        const limit = matchesPrefix(bytes, 1, expected.uuid) ? MAX_TUNNEL_HEADER_BYTES : MAX_TROJAN_HEADER_BYTES;
        if (bytes.length >= limit) {
          pending = new Uint8Array(0);
          finished = true;
          return invalid('Incomplete tunnel header exceeds its size limit');
        }
        // Only an unfinished header is retained. A complete header may be
        // followed by a large first payload, which is never subject to this cap.
        pending = bytes.slice();
      } else {
        pending = new Uint8Array(0);
        finished = true;
      }
      return result;
    },
  };
}
