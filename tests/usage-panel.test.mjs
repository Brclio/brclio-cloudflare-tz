// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/assets/usage.js';
const { usageModel, countdownText } = globalThis.BrclioUsage;
const usage = (workers, pages, max = 100000) => ({ success: true, workers, pages, total: workers + pages, max });

test('usage panel distinguishes unconfigured, failed and a genuine zero result', () => {
  assert.equal(usageModel({}).configured, false);
  const failed = usageModel({ APIToken: '********', Usage: { success: false, total: 0 } });
  assert.equal(failed.configured, true); assert.equal(failed.valid, false); assert.equal(failed.percent, null);
  const zero = usageModel({ Usage: usage(0, 0) });
  assert.equal(zero.valid, true); assert.equal(zero.percent, 0); assert.equal(zero.remaining, 100000);
  for (const invalid of [{ ...usage(1, 1), total: 20 }, { ...usage(1, 1), pages: '1' }, usage(-1, 2), usage(1, 1, 0)]) assert.equal(usageModel({ Usage: invalid }).valid, false);
});
test('segmented bar preserves actual ratios and never overflows when over quota', () => {
  const ordinary = usageModel({ Usage: usage(9670, 10900) });
  assert.deepEqual(ordinary.widths, [9.67, 10.9]); assert.equal(ordinary.percent, 20.57);
  const over = usageModel({ Usage: usage(80000, 50000) });
  assert.equal(over.level, 'exceeded'); assert.equal(over.percent, 130); assert.equal(over.remaining, 0);
  assert.ok(Math.abs(over.widths.reduce((a, b) => a + b, 0) - 100) < .000001);
  assert.ok(over.widths.every(n => n >= 0 && n <= 100));
  assert.equal(usageModel({ Usage: usage(80000, 0) }).level, 'warning');
  assert.equal(usageModel({ UsageAPI: '********', Usage: usage(4, 6, 20) }).percent, 50);
});
test('daily countdown uses UTC midnight and marks yesterday data stale without inventing zero', () => {
  const sampled = Date.parse('2026-09-17T23:59:58Z');
  const before = usageModel({ Usage: usage(25, 30) }, sampled, sampled + 1000);
  assert.equal(before.seconds, 1); assert.equal(before.stale, false); assert.equal(countdownText(before.seconds), '0 小时 0 分 1 秒');
  const after = usageModel({ Usage: usage(25, 30) }, sampled, sampled + 2000);
  assert.equal(after.seconds, 86400); assert.equal(after.stale, true); assert.equal(after.valid, true); assert.equal(after.remaining, 99945);
  assert.equal(after.resetAt, Date.parse('2026-09-19T00:00:00Z'));
  assert.equal(countdownText(69067), '19 小时 11 分 7 秒');
});
