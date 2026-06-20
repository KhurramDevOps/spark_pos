// Money lives as integer paisa everywhere except the UI boundary. These helpers
// are the ONLY place rupees<->paisa conversion happens on the frontend.

/** Read a Mongo Decimal128 value (`{ $numberDecimal }`) or plain value as text. */
export function decimalText(value) {
  if (value == null) return "0";
  if (typeof value === "object" && value.$numberDecimal != null) return value.$numberDecimal;
  return String(value);
}

/** Format integer paisa as a PKR string, e.g. 12000 -> "Rs 120.00". */
export function formatPaisa(paisa) {
  if (paisa == null) return "—";
  const rupees = Number(paisa) / 100;
  return `Rs ${rupees.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Convert a rupees input string to integer paisa. Returns null if invalid. */
export function rupeesToPaisa(input) {
  if (input === "" || input == null) return null;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Convert integer paisa to a rupees string for an input field (no symbol). */
export function paisaToRupeesInput(paisa) {
  if (paisa == null) return "";
  return (Number(paisa) / 100).toFixed(2);
}
