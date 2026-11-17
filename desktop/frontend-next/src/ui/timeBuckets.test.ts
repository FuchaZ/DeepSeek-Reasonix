// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { monthBuckets } from "./timeBuckets";
import "./testkit";

afterEach(() => vi.useRealTimers());

it("cuts a newest-first list into day sections, one mark per section", () => {
  // Buckets are calendar days: the offsets below must not straddle a
  // midnight, so the clock is pinned to local noon instead of racing the
  // hour the suite happens to run at.
  vi.useFakeTimers({ now: new Date(2026, 5, 15, 12, 0, 0) });
  const now = Date.now();
  // 呼叫方的口径：缺失的活动戳按"现在"计。
  const items = [
    { key: "a", at: now },                 // 正在写入
    { key: "b", at: now - 3600_000 },      // 1 小时前 — 今天
    { key: "c", at: now - 2 * 86400_000 }, // 前天 — 7 天内
  ];
  const { marks, counts } = monthBuckets(items);
  expect([...marks.entries()]).toEqual([["a", "今天"], ["c", "7 天内"]]);
  expect(counts.get("今天")).toBe(2);
  expect(counts.get("7 天内")).toBe(1);
});

it("yesterday sits between today and the week tail", () => {
  vi.useFakeTimers({ now: new Date(2026, 5, 15, 12, 0, 0) });
  const now = Date.now();
  const { marks } = monthBuckets([
    { key: "a", at: now },
    { key: "b", at: now - 86400_000 + 60_000 },
    { key: "c", at: now - 3 * 86400_000 },
  ]);
  expect([...marks.entries()]).toEqual([["a", "今天"], ["b", "昨天"], ["c", "7 天内"]]);
});
