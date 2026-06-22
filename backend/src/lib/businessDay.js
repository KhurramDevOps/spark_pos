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
