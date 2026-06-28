// Asia/Karachi civil-date helpers (ADR-010: Pakistan is UTC+5, no DST ever, so a
// fixed offset is exact). Day-granular date math shared across features — warranty
// expiry (spec 009) and khata promised-payment overdue checks (slice 4) both need
// "what is the calendar day in Karachi" without pulling in a timezone library.

export const KARACHI_OFFSET_MIN = 300; // +5h

/** The Asia/Karachi civil { year, month(1-12), day } for an instant (Date | ISO string). */
export function karachiYMD(input) {
  const d = input instanceof Date ? input : new Date(input);
  const shifted = new Date(d.getTime() + KARACHI_OFFSET_MIN * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Compare civil dates as integers (yyyymmdd) for day-granular ordering. */
export function ymdToInt({ year, month, day }) {
  return year * 10000 + month * 100 + day;
}

/** Today's Asia/Karachi civil date. */
export function todayKarachiYMD() {
  return karachiYMD(new Date());
}

/**
 * True when `date` falls strictly before today in Karachi — i.e. that calendar day
 * has fully passed. A promise due "by" a date is overdue only AFTER the day, so the
 * promise day itself returns false.
 */
export function isBeforeTodayKarachi(date) {
  return ymdToInt(karachiYMD(date)) < ymdToInt(todayKarachiYMD());
}
