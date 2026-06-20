/**
 * Exact decimal arithmetic for stock quantities.
 *
 * Quantities are stored as Decimal128 (the shop sells wire/cable/copper in
 * fractional gaz/meter/kg). We never use JS floats for them. The little math we
 * need (the stock-adjustment delta = counted − current) is done with BigInt on
 * scaled integers, which is exact, instead of adding a decimal library.
 *
 * Inputs arrive from the API as strings (see spec 001 §6). These helpers REJECT
 * anything that isn't a finite decimal — they never coerce to 0 or NaN.
 */
import mongoose from "mongoose";

const { Decimal128 } = mongoose.Types;

// Matches an optional sign, digits, optional fractional part. No exponents,
// no whitespace beyond what we trim, no empty string, no "NaN"/"Infinity".
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Validate a quantity input and return its normalized string form.
 * Throws a clear error if the value is not a valid decimal.
 * @param {string|number} value
 * @param {string} fieldName - used in the error message
 */
export function parseDecimal(value, fieldName = "value") {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} is required`);
  }
  const s = String(value).trim();
  if (!DECIMAL_RE.test(s)) {
    throw new Error(`${fieldName} is not a valid decimal: "${value}"`);
  }
  return normalize(s);
}

/** Internal: parse a validated decimal string into { value: BigInt, scale }. */
function toScaled(s) {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracPart = ""] = body.split(".");
  const digits = intPart + fracPart;
  let value = BigInt(digits);
  if (neg) value = -value;
  return { value, scale: fracPart.length };
}

/** Internal: render a BigInt + scale back to a trimmed decimal string. */
function scaledToString(value, scale) {
  const neg = value < 0n;
  let digits = (neg ? -value : value).toString();
  let out;
  if (scale === 0) {
    out = digits;
  } else {
    digits = digits.padStart(scale + 1, "0");
    const intPart = digits.slice(0, digits.length - scale);
    let fracPart = digits.slice(digits.length - scale).replace(/0+$/, "");
    out = fracPart ? `${intPart}.${fracPart}` : intPart;
  }
  return neg && out !== "0" ? `-${out}` : out;
}

/** Normalize a valid decimal string (strip leading/trailing-zero noise, sign on 0). */
export function normalize(s) {
  const { value, scale } = toScaled(s);
  return scaledToString(value, scale);
}

/**
 * Exact subtraction: returns (a − b) as a normalized decimal string.
 * @param {string|number} a
 * @param {string|number} b
 */
export function subtract(a, b, aField = "a", bField = "b") {
  const x = toScaled(parseDecimal(a, aField));
  const y = toScaled(parseDecimal(b, bField));
  const scale = Math.max(x.scale, y.scale);
  const xv = x.value * 10n ** BigInt(scale - x.scale);
  const yv = y.value * 10n ** BigInt(scale - y.scale);
  return scaledToString(xv - yv, scale);
}

/** True if the (valid) decimal string represents zero. */
export function isZero(s) {
  return normalize(parseDecimal(s)) === "0";
}

/** True if the (valid) decimal string is strictly negative. */
export function isNegative(s) {
  return toScaled(parseDecimal(s)).value < 0n;
}

/** Convert a validated decimal value to a Mongoose Decimal128. */
export function toDecimal128(value, fieldName = "value") {
  return Decimal128.fromString(parseDecimal(value, fieldName));
}

/** Decimal128 (or any value) -> normalized string, for comparisons/output. */
export function decimalToString(value) {
  return normalize(String(value));
}
