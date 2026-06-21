/**
 * Exact decimal arithmetic for stock quantities and money (paisa).
 *
 * Quantities are stored as Decimal128 (the shop sells wire/cable/copper in
 * fractional gaz/meter/kg), and from spec 003 weighted-average cost (avgCost) is
 * computed here too. We never use JS floats. add/subtract/multiply are EXACT on
 * BigInt scaled integers; divide is the one inexact op (e.g. 17000/150) and so
 * takes an explicit fractional `scale` and a rounding mode — no decimal library.
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

/** Internal: align two scaled values to a common scale; returns { xv, yv, scale }. */
function align(a, b, aField, bField) {
  const x = toScaled(parseDecimal(a, aField));
  const y = toScaled(parseDecimal(b, bField));
  const scale = Math.max(x.scale, y.scale);
  return {
    xv: x.value * 10n ** BigInt(scale - x.scale),
    yv: y.value * 10n ** BigInt(scale - y.scale),
    scale,
  };
}

/**
 * Exact addition: returns (a + b) as a normalized decimal string.
 * @param {string|number} a
 * @param {string|number} b
 */
export function add(a, b, aField = "a", bField = "b") {
  const { xv, yv, scale } = align(a, b, aField, bField);
  return scaledToString(xv + yv, scale);
}

/**
 * Exact subtraction: returns (a − b) as a normalized decimal string.
 * @param {string|number} a
 * @param {string|number} b
 */
export function subtract(a, b, aField = "a", bField = "b") {
  const { xv, yv, scale } = align(a, b, aField, bField);
  return scaledToString(xv - yv, scale);
}

/**
 * Exact multiplication: returns (a × b) as a normalized decimal string.
 * Scale of the product is the sum of the input scales (no rounding needed).
 * @param {string|number} a
 * @param {string|number} b
 */
export function multiply(a, b, aField = "a", bField = "b") {
  const x = toScaled(parseDecimal(a, aField));
  const y = toScaled(parseDecimal(b, bField));
  return scaledToString(x.value * y.value, x.scale + y.scale);
}

/** Rounding modes for divide/round. */
export const HALF_EVEN = "half-even"; // banker's — default for cost (no upward bias)
export const HALF_UP = "half-up";

/**
 * Apply a rounding mode to a truncated quotient using the remainder.
 * @param {bigint} q - truncated (toward zero) quotient magnitude
 * @param {bigint} r - remainder magnitude (>= 0)
 * @param {bigint} d - divisor magnitude (> 0)
 * @param {string} mode
 * @returns {bigint} possibly-incremented magnitude
 */
function applyRounding(q, r, d, mode) {
  if (r === 0n) return q;
  const twice = r * 2n;
  if (mode === HALF_UP) {
    return twice >= d ? q + 1n : q;
  }
  // HALF_EVEN
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n; // exactly half -> round to even
}

/**
 * Division to a fixed number of fractional digits with an explicit rounding mode.
 * This is the only inexact operation; the caller chooses precision. Used for
 * weighted-average cost (spec 003: scale 10, HALF_EVEN). Throws on divide-by-zero.
 * @param {string|number} a - dividend
 * @param {string|number} b - divisor
 * @param {number} scale - fractional digits to keep (>= 0)
 * @param {string} [rounding] - HALF_EVEN (default) | HALF_UP
 * @returns {string} normalized quotient string
 */
export function divide(a, b, scale, rounding = HALF_EVEN) {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`divide: scale must be a non-negative integer (got ${scale})`);
  }
  const x = toScaled(parseDecimal(a, "dividend"));
  const y = toScaled(parseDecimal(b, "divisor"));
  if (y.value === 0n) throw new Error("divide: division by zero");

  const neg = x.value < 0n !== y.value < 0n;
  // We want (x / y) to `scale` fractional digits. Scale the numerator up so that
  // integer division yields exactly `scale` extra digits, accounting for the
  // input scales: result_value/10^scale = (x.value/10^x.scale)/(y.value/10^y.scale).
  let num = absBig(x.value) * 10n ** BigInt(scale + y.scale);
  const den = absBig(y.value) * 10n ** BigInt(x.scale);
  const q = num / den;
  const r = num % den;
  const rounded = applyRounding(q, r, den, rounding);
  return scaledToString(neg ? -rounded : rounded, scale);
}

/**
 * Round a decimal to `scale` fractional digits (e.g. a payable to whole paisa
 * with scale 0). Implemented as divide-by-one.
 * @param {string|number} value
 * @param {number} scale
 * @param {string} [rounding]
 */
export function round(value, scale, rounding = HALF_EVEN) {
  return divide(value, "1", scale, rounding);
}

/** Internal: absolute value of a BigInt. */
function absBig(v) {
  return v < 0n ? -v : v;
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
