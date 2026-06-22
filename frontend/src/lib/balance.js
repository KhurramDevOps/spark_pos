import { formatPaisa } from "./format";

/**
 * Describe a supplier balance (paisa, as a decimal string/number) for display.
 * Positive = owner owes the supplier; negative = advance/overpayment (supplier
 * effectively owes the owner); zero = settled. Surfaced, never blocked (spec 003 §6).
 *
 * @returns {{ text: string, tone: "amber"|"green"|"gray", className: string }}
 */
export function formatBalance(paisa) {
  const n = Number(paisa);
  if (!Number.isFinite(n) || n === 0) {
    return { text: "Settled", tone: "gray", className: "text-gray-500" };
  }
  if (n > 0) {
    return {
      text: `${formatPaisa(n)} owed`,
      tone: "amber",
      className: "text-amber-700",
    };
  }
  return {
    text: `${formatPaisa(-n)} advance`,
    tone: "green",
    className: "text-green-700",
  };
}
