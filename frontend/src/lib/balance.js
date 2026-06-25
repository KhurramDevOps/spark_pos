import { formatPaisa } from "./format";

/**
 * Describe a running balance (paisa, as a decimal string/number) for display.
 *
 * Default wording is supplier-sense: positive = the owner owes (amber);
 * negative = an advance the other side has effectively given (green); zero =
 * settled. Surfaced, never blocked (spec 003 §6).
 *
 * For a CUSTOMER the sense is the same numerically but the wording is opposite
 * in meaning: positive = the customer owes the shop, negative = the customer paid
 * in advance / the shop owes THEM. Pass custom labels for that (spec 004).
 *
 * @param {string|number} paisa
 * @param {{ owedLabel?: string, advanceLabel?: string }} [labels]
 * @returns {{ text: string, tone: "amber"|"green"|"gray", className: string }}
 */
export function formatBalance(paisa, { owedLabel = "owed", advanceLabel = "advance" } = {}) {
  const n = Number(paisa);
  if (!Number.isFinite(n) || n === 0) {
    return { text: "Settled", tone: "gray", className: "text-fg-muted" };
  }
  if (n > 0) {
    return {
      text: `${formatPaisa(n)} ${owedLabel}`,
      tone: "amber",
      className: "text-amber-700 dark:text-amber-400",
    };
  }
  return {
    text: `${formatPaisa(-n)} ${advanceLabel}`,
    tone: "green",
    className: "text-green-700 dark:text-green-400",
  };
}

// Customer-sense labels: a negative balance means the customer is in credit and
// the shop owes them (opposite of a supplier advance).
export const CUSTOMER_BALANCE_LABELS = { owedLabel: "owed", advanceLabel: "in credit (you owe them)" };
