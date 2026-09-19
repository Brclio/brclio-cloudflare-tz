// Copyright (C) 2026 Brclio. GPL-2.0-only.
export const DEFAULT_RANDOM_NODE_COUNT = 64;
export const MAX_RANDOM_NODE_COUNT = 1000;

// Stored configuration can predate API validation. Keep valid choices and bound
// malformed legacy values before allocating a subscription candidate list.
export function normalizeRandomNodeCount(value) {
  return Number.isInteger(value) && value >= 1
    ? Math.min(value, MAX_RANDOM_NODE_COUNT)
    : DEFAULT_RANDOM_NODE_COUNT;
}

function ipv4Interval(cidr) {
  if (typeof cidr !== 'string') return null;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/.exec(cidr.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some(octet => octet > 255)) return null;
  const address = octets.reduce((value, octet) => value * 256 + octet, 0);
  const size = 2 ** (32 - Number(match[5]));
  const start = Math.floor(address / size) * size;
  return { start, end: start + size - 1 };
}

// Sample the union of IPv4 ranges without replacement. Merging first avoids
// duplicate addresses and extra weighting when a source repeats/overlaps ranges.
// Sparse Fisher-Yates needs O(count) memory even for the entire IPv4 /0 range.
export function sampleUniqueIPv4(cidrs, count = DEFAULT_RANDOM_NODE_COUNT, random = Math.random) {
  const sorted = cidrs.map(ipv4Interval).filter(Boolean).sort((a, b) => a.start - b.start);
  const ranges = [];
  for (const range of sorted) {
    const previous = ranges.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else ranges.push({ ...range });
  }
  let capacity = 0;
  for (const range of ranges) {
    range.offset = capacity;
    capacity += range.end - range.start + 1;
    range.limit = capacity;
  }
  const size = Math.min(normalizeRandomNodeCount(count), capacity);
  const swaps = new Map();
  const addresses = [];
  for (let index = 0; index < size; index++) {
    const remaining = capacity - index;
    const selected = Math.floor(random() * remaining);
    const rank = swaps.get(selected) ?? selected;
    swaps.set(selected, swaps.get(remaining - 1) ?? remaining - 1);
    swaps.delete(remaining - 1);
    let low = 0, high = ranges.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (rank < ranges[middle].limit) high = middle;
      else low = middle + 1;
    }
    const range = ranges[low];
    const address = range.start + rank - range.offset;
    addresses.push([24, 16, 8, 0].map(shift => (address >>> shift) & 255).join('.'));
  }
  return addresses;
}
