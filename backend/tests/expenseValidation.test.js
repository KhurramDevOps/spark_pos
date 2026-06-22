import test from "node:test";
import assert from "node:assert/strict";
import {
  createExpenseSchema,
  createDrawerAdjustmentSchema,
  saveDayCloseSchema,
} from "../../shared/validation/expense.js";

test("expense: valid input passes", () => {
  assert.equal(createExpenseSchema.safeParse({ category: "salary", amount: "15000" }).success, true);
  assert.equal(createExpenseSchema.safeParse({ category: "electricity", amount: "1200.50", note: "june" }).success, true);
});

test("expense: bad category, zero/negative/over-2dp amount rejected", () => {
  assert.equal(createExpenseSchema.safeParse({ category: "rent", amount: "100" }).success, false); // not in enum
  assert.equal(createExpenseSchema.safeParse({ category: "other", amount: "0" }).success, false); // not > 0
  assert.equal(createExpenseSchema.safeParse({ category: "other", amount: "-5" }).success, false); // sign rejected by money rule
  assert.equal(createExpenseSchema.safeParse({ category: "other", amount: "1.555" }).success, false); // > 2dp
});

test("expense: future date rejected", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(createExpenseSchema.safeParse({ category: "other", amount: "100", date: future }).success, false);
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(createExpenseSchema.safeParse({ category: "other", amount: "100", date: past }).success, true);
});

test("drawer adjustment: direction enum + amount validated", () => {
  assert.equal(createDrawerAdjustmentSchema.safeParse({ direction: "in", amount: "5000" }).success, true);
  assert.equal(createDrawerAdjustmentSchema.safeParse({ direction: "out", amount: "5000" }).success, true);
  assert.equal(createDrawerAdjustmentSchema.safeParse({ direction: "sideways", amount: "5000" }).success, false);
  assert.equal(createDrawerAdjustmentSchema.safeParse({ direction: "in", amount: "0" }).success, false);
});

test("day close: actualCash >= 0 (0 allowed) + YYYY-MM-DD date", () => {
  assert.equal(saveDayCloseSchema.safeParse({ date: "2026-06-23", actualCash: "0" }).success, true);
  assert.equal(saveDayCloseSchema.safeParse({ date: "2026-06-23", actualCash: "8200" }).success, true);
  assert.equal(saveDayCloseSchema.safeParse({ date: "06-23-2026", actualCash: "100" }).success, false); // bad format
  assert.equal(saveDayCloseSchema.safeParse({ date: "2026-06-23", actualCash: "-5" }).success, false); // negative
});
