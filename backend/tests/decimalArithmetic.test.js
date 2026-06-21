import test from "node:test";
import assert from "node:assert/strict";

import { add, subtract, multiply, divide, round, HALF_EVEN, HALF_UP } from "../src/lib/decimal.js";

test("add is exact across scales and signs", () => {
  assert.equal(add("1.5", "2.25"), "3.75");
  assert.equal(add("100", "0.001"), "100.001");
  assert.equal(add("-5", "5"), "0");
  assert.equal(add("-1.1", "-2.2"), "-3.3");
});

test("subtract still works after the align refactor", () => {
  assert.equal(subtract("7", "10"), "-3");
  assert.equal(subtract("2.5", "1.25"), "1.25");
});

test("multiply is exact (scale = sum of input scales)", () => {
  assert.equal(multiply("2.5", "11050"), "27625"); // 2.5 gaz @ 110.50 rupees = 27625 paisa
  assert.equal(multiply("0.333", "11050"), "3679.65"); // fractional qty -> fractional paisa
  assert.equal(multiply("-3", "4"), "-12");
  assert.equal(multiply("0", "999"), "0");
});

test("divide: the spec 003 worked example (100@11000p then 50@12000p)", () => {
  // numerator = 100*11000 + 50*12000 = 1,700,000 ; denominator = 150
  assert.equal(divide("1700000", "150", 10, HALF_EVEN), "11333.3333333333");
});

test("divide rounds half-even (banker's) at the kept digit", () => {
  assert.equal(divide("5", "2", 0, HALF_EVEN), "2"); // 2.5 -> 2 (even)
  assert.equal(divide("7", "2", 0, HALF_EVEN), "4"); // 3.5 -> 4 (even)
  assert.equal(divide("5", "4", 1, HALF_EVEN), "1.2"); // 1.25 -> 1.2 (even)
  assert.equal(divide("15", "4", 1, HALF_EVEN), "3.8"); // 3.75 -> 3.8 (even)
});

test("divide supports half-up too", () => {
  assert.equal(divide("5", "2", 0, HALF_UP), "3");
  assert.equal(divide("5", "4", 1, HALF_UP), "1.3");
});

test("divide handles signs and exact results", () => {
  assert.equal(divide("-1700000", "150", 10), "-11333.3333333333");
  assert.equal(divide("1700000", "-150", 10), "-11333.3333333333");
  assert.equal(divide("100", "4", 2), "25"); // exact, trailing zeros trimmed
});

test("divide throws on division by zero", () => {
  assert.throws(() => divide("1", "0", 10), /division by zero/);
});

test("round to whole paisa (payable) uses half-even", () => {
  assert.equal(round("3679.65", 0), "3680");
  assert.equal(round("100.5", 0), "100"); // -> even
  assert.equal(round("101.5", 0), "102"); // -> even
  assert.equal(round("27625.4", 0), "27625");
});
