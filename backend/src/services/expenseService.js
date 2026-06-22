import Expense, { EXPENSE_CATEGORY_VALUES } from "../models/Expense.js";
import DrawerAdjustment, { DRAWER_DIRECTIONS } from "../models/DrawerAdjustment.js";
import { parseDecimal, toDecimal128, isNegative, isZero } from "../lib/decimal.js";

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function positiveAmount(raw) {
  const amount = parseDecimal(raw, "amount");
  if (isNegative(amount) || isZero(amount)) throw httpError("amount must be greater than 0", 400);
  return toDecimal128(amount);
}

// ---- Expenses (flat; no ledger, no transaction — ADR-009) -----------------

export async function recordExpense(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");
  if (!EXPENSE_CATEGORY_VALUES.includes(input.category)) throw httpError("invalid expense category", 400);
  return Expense.create({
    date: input.date ?? new Date(),
    category: input.category,
    amount: positiveAmount(input.amount),
    note: input.note,
    createdBy: userId,
  });
}

export async function updateExpense(id, patch) {
  const expense = await Expense.findById(id);
  if (!expense) throw httpError("expense not found", 404);
  if (patch.category !== undefined) {
    if (!EXPENSE_CATEGORY_VALUES.includes(patch.category)) throw httpError("invalid expense category", 400);
    expense.category = patch.category;
  }
  if (patch.amount !== undefined) expense.amount = positiveAmount(patch.amount);
  if (patch.date !== undefined) expense.date = patch.date;
  if (patch.note !== undefined) expense.note = patch.note ?? undefined;
  await expense.save();
  return expense;
}

export async function deleteExpense(id) {
  const expense = await Expense.findByIdAndDelete(id);
  if (!expense) throw httpError("expense not found", 404);
  return { deleted: true, id };
}

export async function listExpenses({ from, to } = {}) {
  const query = {};
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }
  return Expense.find(query).sort({ createdAt: -1 });
}

// ---- Drawer adjustments (flat) --------------------------------------------

export async function recordDrawerAdjustment(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");
  if (!DRAWER_DIRECTIONS.includes(input.direction)) throw httpError("direction must be in or out", 400);
  return DrawerAdjustment.create({
    date: input.date ?? new Date(),
    direction: input.direction,
    amount: positiveAmount(input.amount),
    note: input.note,
    createdBy: userId,
  });
}

export async function listDrawerAdjustments({ from, to } = {}) {
  const query = {};
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }
  return DrawerAdjustment.find(query).sort({ createdAt: -1 });
}
