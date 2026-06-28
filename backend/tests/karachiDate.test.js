import test from "node:test";
import assert from "node:assert/strict";

import { karachiYMD, ymdToInt, isBeforeTodayKarachi } from "../../shared/date/karachi.js";

test("karachiYMD shifts a UTC instant into the Asia/Karachi (+5) civil date", () => {
  // 2026-06-27 21:00 UTC = 2026-06-28 02:00 Karachi → civil day is the 28th.
  assert.deepEqual(karachiYMD(new Date("2026-06-27T21:00:00Z")), { year: 2026, month: 6, day: 28 });
  // 2026-06-27 18:00 UTC = 2026-06-27 23:00 Karachi → still the 27th.
  assert.deepEqual(karachiYMD(new Date("2026-06-27T18:00:00Z")), { year: 2026, month: 6, day: 27 });
});

test("ymdToInt orders civil dates as comparable integers", () => {
  assert.ok(ymdToInt({ year: 2026, month: 6, day: 27 }) < ymdToInt({ year: 2026, month: 6, day: 28 }));
  assert.ok(ymdToInt({ year: 2025, month: 12, day: 31 }) < ymdToInt({ year: 2026, month: 1, day: 1 }));
});

test("isBeforeTodayKarachi: yesterday is overdue, today and tomorrow are not", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  assert.equal(isBeforeTodayKarachi(new Date(now - 2 * dayMs)), true); // clearly past
  assert.equal(isBeforeTodayKarachi(new Date(now + 2 * dayMs)), false); // future
  // "by today" is NOT yet overdue — the promise day itself still has until its end.
  assert.equal(isBeforeTodayKarachi(new Date(now)), false);
});
