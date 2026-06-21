import { z } from "zod";

/**
 * The ONE rupee→paisa rule, shared by CSV import (spec 002) and purchases
 * (spec 003). Money is entered in rupees with up to 2 decimal places and stored
 * as integer paisa. Rejects thousands separators / currency symbols and >2 dp —
 * never rounds money silently.
 */

// Digits with a single optional decimal point. No sign (money here is >= 0), no
// commas, no symbols, no exponents.
export const MONEY_DECIMAL_RE = /^\d+(\.\d+)?$/;

/**
 * Parse a rupee amount string into integer paisa.
 * @param {string|number} raw
 * @param {string} [fieldName] - used in the error message
 * @returns {{ value: number } | { error: string }}
 */
export function rupeesToPaisa(raw, fieldName = "amount") {
  const s = String(raw).trim();
  if (!MONEY_DECIMAL_RE.test(s)) {
    return {
      error: `${fieldName} must be a number — digits and a single optional decimal point only (no commas or currency symbols)`,
    };
  }
  const [intPart, fracPart = ""] = s.split(".");
  if (fracPart.length > 2) {
    return { error: `${fieldName} has more than 2 decimal places ("${s}") — enter rupees and paisa only` };
  }
  const paisa = Number(intPart) * 100 + Number(fracPart.padEnd(2, "0") || "0");
  return { value: paisa };
}

/**
 * A Zod schema for a rupee-money *string* (>= 0, <= 2 dp), reusing the one rule
 * above so frontend + backend validate money identically.
 * @param {string} [fieldName]
 */
export const rupeesString = (fieldName = "amount") =>
  z.string().superRefine((val, ctx) => {
    const r = rupeesToPaisa(val, fieldName);
    if (r.error) ctx.addIssue({ code: "custom", message: r.error });
  });
