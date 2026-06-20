import test from "node:test";
import assert from "node:assert/strict";
import { parseDecimal, subtract, isZero, isNegative, normalize } from "../src/lib/decimal.js";

test("parseDecimal rejects non-decimal strings (never coerces to 0/NaN)", () => {
  for (const bad of ["abc", "", " ", "1.2.3", "NaN", "Infinity", "1e3", "--1", "1,5"]) {
    assert.throws(() => parseDecimal(bad, "qty"), /not a valid decimal|required/, `should reject "${bad}"`);
  }
});

test("parseDecimal accepts and normalizes valid decimals", () => {
  assert.equal(parseDecimal(" 3.0 "), "3");
  assert.equal(parseDecimal("007.50"), "7.5");
  assert.equal(parseDecimal("-0"), "0");
  assert.equal(parseDecimal(2.5), "2.5");
});

test("subtract is exact for integers and fractions", () => {
  assert.equal(subtract("10", "7"), "3");
  assert.equal(subtract("7", "10"), "-3"); // counted 7 - current 10
  assert.equal(subtract("2.5", "1.25"), "1.25");
  assert.equal(subtract("1.25", "2.5"), "-1.25");
  assert.equal(subtract("2.50", "2.5"), "0");
  assert.equal(subtract("0.1", "0.3"), "-0.2"); // would drift as float
});

test("isZero / isNegative", () => {
  assert.equal(isZero("0.000"), true);
  assert.equal(isZero("0.01"), false);
  assert.equal(isNegative("-0.5"), true);
  assert.equal(isNegative("-0"), false);
  assert.equal(isNegative("0"), false);
  assert.equal(isNegative("3"), false);
});

test("normalize trims noise and signs zero correctly", () => {
  assert.equal(normalize("-0"), "0");
  assert.equal(normalize("12.300"), "12.3");
  assert.equal(normalize("0.50"), "0.5");
});
