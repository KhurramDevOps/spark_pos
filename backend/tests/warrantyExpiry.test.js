import test from "node:test";
import assert from "node:assert/strict";

import { warrantyExpiry, warrantyStatus, formatYmd } from "../../shared/warranty/expiry.js";

// Sale instants are stored UTC; the warranty clock is the Asia/Karachi civil date
// (ADR-010, fixed +5). Use a midday-Karachi instant so the offset can't flip the day.
const saleAt = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 7, 0, 0)); // 12:00 Karachi

test("years: simple add lands on the same month/day", () => {
  const e = warrantyExpiry(saleAt(2024, 6, 15), { durationValue: 10, durationUnit: "years" });
  assert.deepEqual(e, { year: 2034, month: 6, day: 15 });
});

test("months: rolls the year correctly", () => {
  const e = warrantyExpiry(saleAt(2024, 11, 10), { durationValue: 3, durationUnit: "months" });
  assert.deepEqual(e, { year: 2025, month: 2, day: 10 });
});

test("days: calendar day addition crosses months", () => {
  const e = warrantyExpiry(saleAt(2024, 1, 25), { durationValue: 10, durationUnit: "days" });
  assert.deepEqual(e, { year: 2024, month: 2, day: 4 });
});

test("end-of-month clamp: Jan 31 + 1 month → Feb 28 (non-leap)", () => {
  const e = warrantyExpiry(saleAt(2025, 1, 31), { durationValue: 1, durationUnit: "months" });
  assert.deepEqual(e, { year: 2025, month: 2, day: 28 });
});

test("leap-day clamp: Feb 29 2024 + 1 year → Feb 28 2025", () => {
  const e = warrantyExpiry(saleAt(2024, 2, 29), { durationValue: 1, durationUnit: "years" });
  assert.deepEqual(e, { year: 2025, month: 2, day: 28 });
});

test("leap-day kept when target year is also leap: Feb 29 2024 + 4 years → Feb 29 2028", () => {
  const e = warrantyExpiry(saleAt(2024, 2, 29), { durationValue: 4, durationUnit: "years" });
  assert.deepEqual(e, { year: 2028, month: 2, day: 29 });
});

test("status: valid before expiry, valid ON the expiry day (inclusive), expired after", () => {
  const sale = saleAt(2024, 6, 15);
  const term = { durationValue: 1, durationUnit: "years" }; // expiry 2025-06-15
  assert.equal(warrantyStatus(sale, term, saleAt(2025, 6, 14)).valid, true);
  assert.equal(warrantyStatus(sale, term, saleAt(2025, 6, 15)).valid, true); // inclusive
  assert.equal(warrantyStatus(sale, term, saleAt(2025, 6, 16)).valid, false);
});

test("status returns the computed expiry parts alongside validity", () => {
  const s = warrantyStatus(saleAt(2024, 6, 15), { durationValue: 2, durationUnit: "years" }, saleAt(2025, 1, 1));
  assert.deepEqual(s.expiry, { year: 2026, month: 6, day: 15 });
  assert.equal(s.valid, true);
});

test("formatYmd renders zero-padded DD-MM-YYYY", () => {
  assert.equal(formatYmd({ year: 2025, month: 2, day: 8 }), "08-02-2025");
});
