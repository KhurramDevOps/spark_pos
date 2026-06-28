import { isBeforeTodayKarachi } from "@shared/date/karachi.js";
import { decimalText } from "../../lib/format";

/**
 * A khata is OVERDUE when a "promised to pay by" date has passed (Asia/Karachi day)
 * AND the customer still owes money (balance > 0). Store-credit (balance < 0) or a
 * settled balance is never overdue, even with a stale promise date. Derived display
 * only — no money effect (slice 4).
 */
export function khataOverdue(customer) {
  if (!customer?.promisedPayBy) return false;
  if (!(Number(decimalText(customer.balance)) > 0)) return false;
  return isBeforeTodayKarachi(customer.promisedPayBy);
}

/** Promised date as a short DD-MM-YYYY label (or "" when none). */
export function promisedDateLabel(customer) {
  if (!customer?.promisedPayBy) return "";
  const [y, m, d] = customer.promisedPayBy.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}
