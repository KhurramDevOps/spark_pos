// Warranty expiry math (spec 009). Pure + shared by frontend (Sale Detail live
// status) and backend (tests). The warranty clock runs from `Sale.date` measured as
// an Asia/Karachi civil date (ADR-010: fixed +5, no DST). All comparisons are at DAY
// granularity — a warranty is valid through the END of its expiry day (inclusive).

import { karachiYMD, ymdToInt } from "../date/karachi.js";

// Re-exported so existing warranty importers keep their import site unchanged.
export { karachiYMD, ymdToInt };

/** Days in a 1-based month (handles leap Feb). */
function daysInMonth(year, month) {
  // Date.UTC month is 0-based; passing `month` (1-based) with day 0 → last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Calendar-add a warranty term's duration to the sale date, clamping end-of-month
 * (Jan-31 + 1 month → Feb-28/29; Feb-29 + 1 year → Feb-28). Returns civil { year,
 * month, day }.
 */
export function warrantyExpiry(saleDate, term) {
  const { year, month, day } = karachiYMD(saleDate);
  const value = Number(term.durationValue);

  if (term.durationUnit === "days") {
    // Pure day arithmetic never needs an end-of-month clamp.
    const base = new Date(Date.UTC(year, month - 1, day));
    base.setUTCDate(base.getUTCDate() + value);
    return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
  }

  let y = year;
  let m = month;
  if (term.durationUnit === "years") {
    y += value;
  } else {
    // months
    const total = month - 1 + value;
    y += Math.floor(total / 12);
    m = (total % 12) + 1;
  }
  const maxDay = daysInMonth(y, m);
  return { year: y, month: m, day: Math.min(day, maxDay) };
}

/**
 * Warranty status of a term as of `claimDate` (default now). `valid` is true when
 * the claim date is on or before the expiry day (inclusive). Returns the computed
 * `expiry` parts too, so callers can render "Valid until / Expired on <date>".
 */
export function warrantyStatus(saleDate, term, claimDate = new Date()) {
  const expiry = warrantyExpiry(saleDate, term);
  const claim = karachiYMD(claimDate);
  return { valid: ymdToInt(claim) <= ymdToInt(expiry), expiry };
}

/** Render civil { year, month, day } as zero-padded DD-MM-YYYY. */
export function formatYmd({ year, month, day }) {
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}
