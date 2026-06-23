/**
 * Asia/Karachi day bucketing for the daily close (spec 005 / ADR-010).
 *
 * Pakistan is UTC+5 with NO DST (ever), so a fixed offset is exact — no tz
 * dependency. Mongo stores instants as UTC; these helpers turn a Karachi calendar
 * day into the [start, end] UTC instants to query `createdAt` against.
 * (Revisit ONLY if Pakistan ever adopts DST.)
 */
export const ASIA_KARACHI_OFFSET_MIN = 300;
const OFF = ASIA_KARACHI_OFFSET_MIN * 60 * 1000;
const DAY = 86400000;

/** UTC instant of Karachi midnight for the Karachi day that `instant` falls in. */
export function karachiDayStart(instant) {
  const shifted = new Date(instant.getTime() + OFF); // read UTC methods as Karachi wall clock
  const wallMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(wallMidnight - OFF);
}

/** [start, end] UTC instants for the Karachi day containing `instant`. */
export function karachiDayRange(instant) {
  const start = karachiDayStart(instant);
  return { start, end: new Date(start.getTime() + DAY - 1) };
}

/** [start, end] for a Karachi calendar date string 'YYYY-MM-DD'. */
export function karachiDayRangeFromYMD(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - OFF);
  return { start, end: new Date(start.getTime() + DAY - 1) };
}

/** Resolve a day input (Date | 'YYYY-MM-DD' | undefined=today) to a Karachi range. */
export function resolveKarachiDay(input) {
  if (input instanceof Date) return karachiDayRange(input);
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) return karachiDayRangeFromYMD(input);
  return karachiDayRange(input ? new Date(input) : new Date());
}

// --- Window resolvers for reports (spec 006) -------------------------------
// All built on the same fixed Karachi offset (ADR-010): Date.UTC normalizes
// month/year overflow, so month/week math is correct across boundaries.

export const REPORT_WINDOWS = ["today", "this_week", "this_month", "last_month", "custom"];

/** Karachi calendar parts of an instant (wall-clock read via the fixed offset). */
function karachiParts(instant) {
  const s = new Date(instant.getTime() + OFF);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), dow: s.getUTCDay() };
}
/** [start, end] UTC instants spanning `n` Karachi days from calendar (y,m,d). */
function daysRange(y, m, d, n) {
  const start = new Date(Date.UTC(y, m, d) - OFF);
  return { start, end: new Date(start.getTime() + n * DAY - 1) };
}
/** [start, end] for the whole Karachi month containing calendar (y, m). */
function monthRange(y, m) {
  return { start: new Date(Date.UTC(y, m, 1) - OFF), end: new Date(Date.UTC(y, m + 1, 1) - OFF - 1) };
}
function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}
function customRange(startYMD, endYMD) {
  for (const v of [startYMD, endYMD]) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw badRequest("custom window needs start and end as YYYY-MM-DD");
    }
  }
  const [ys, ms, ds] = startYMD.split("-").map(Number);
  const [ye, me, de] = endYMD.split("-").map(Number);
  const start = new Date(Date.UTC(ys, ms - 1, ds) - OFF);
  const end = new Date(Date.UTC(ye, me - 1, de + 1) - OFF - 1); // inclusive of end day
  if (end < start) throw badRequest("custom window end must be on or after start");
  return { start, end };
}

/**
 * Resolve a report window spec to `{ start, end, prior: { start, end } }` as UTC
 * instants (spec 006 §6). `prior` is the immediately preceding comparable window:
 * today→yesterday, week→prior week, month→prior month, custom→preceding
 * equal-length range. `now` is injectable for tests.
 */
export function resolveWindow(input, now = new Date()) {
  const w = input?.window;
  const p = karachiParts(now);
  switch (w) {
    case "today":
      return { ...daysRange(p.y, p.m, p.d, 1), prior: daysRange(p.y, p.m, p.d - 1, 1) };
    case "this_week": {
      const off = (p.dow + 6) % 7; // days since Monday (Mon=0 … Sun=6)
      return { ...daysRange(p.y, p.m, p.d - off, 7), prior: daysRange(p.y, p.m, p.d - off - 7, 7) };
    }
    case "this_month":
      return { ...monthRange(p.y, p.m), prior: monthRange(p.y, p.m - 1) };
    case "last_month":
      return { ...monthRange(p.y, p.m - 1), prior: monthRange(p.y, p.m - 2) };
    case "custom": {
      const cur = customRange(input.start, input.end);
      const lenMs = cur.end.getTime() + 1 - cur.start.getTime();
      return { ...cur, prior: { start: new Date(cur.start.getTime() - lenMs), end: new Date(cur.start.getTime() - 1) } };
    }
    default:
      throw badRequest(`unknown report window "${w}"`);
  }
}

/** Yield each Karachi day's [start, end] across a window, for per-day bucketing. */
export function eachKarachiDay({ start, end }) {
  const days = [];
  let dayStart = karachiDayStart(start);
  while (dayStart.getTime() <= end.getTime()) {
    days.push({ start: dayStart, end: new Date(dayStart.getTime() + DAY - 1) });
    dayStart = new Date(dayStart.getTime() + DAY);
  }
  return days;
}

/** 'YYYY-MM-DD' Karachi label for a day-start instant (trend bucket key). */
export function karachiYMDLabel(instant) {
  const s = new Date(instant.getTime() + OFF);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
}
