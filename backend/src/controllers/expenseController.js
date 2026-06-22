import {
  recordExpense,
  listExpenses,
  updateExpense,
  deleteExpense,
  recordDrawerAdjustment,
  listDrawerAdjustments,
} from "../services/expenseService.js";
import { rupeesToPaisa } from "../../../shared/validation/money.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const dateRange = (q) => ({
  from: q.from ? new Date(q.from) : undefined,
  to: q.to ? new Date(q.to) : undefined,
});

// ---- Expenses -------------------------------------------------------------

export const create = wrap(async (req, res) => {
  const v = req.validated;
  const expense = await recordExpense(
    { date: v.date, category: v.category, amount: String(rupeesToPaisa(v.amount, "amount").value), note: v.note },
    { userId: req.userId }
  );
  res.status(201).json(expense);
});

export const list = wrap(async (req, res) => {
  res.json(await listExpenses(dateRange(req.query)));
});

export const update = wrap(async (req, res) => {
  const v = req.validated;
  const patch = {};
  if (v.category !== undefined) patch.category = v.category;
  if (v.amount !== undefined) patch.amount = String(rupeesToPaisa(v.amount, "amount").value);
  if (v.date !== undefined) patch.date = v.date;
  if (v.note !== undefined) patch.note = v.note;
  res.json(await updateExpense(req.params.id, patch));
});

export const remove = wrap(async (req, res) => {
  res.json(await deleteExpense(req.params.id));
});

// ---- Drawer adjustments ---------------------------------------------------

export const createDrawer = wrap(async (req, res) => {
  const v = req.validated;
  const adj = await recordDrawerAdjustment(
    { date: v.date, direction: v.direction, amount: String(rupeesToPaisa(v.amount, "amount").value), note: v.note },
    { userId: req.userId }
  );
  res.status(201).json(adj);
});

export const listDrawer = wrap(async (req, res) => {
  res.json(await listDrawerAdjustments(dateRange(req.query)));
});
