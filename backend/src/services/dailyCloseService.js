import Sale from "../models/Sale.js";
import CustomerPayment from "../models/CustomerPayment.js";
import SupplierPayment from "../models/SupplierPayment.js";
import CustomerReturn from "../models/CustomerReturn.js";
import Expense from "../models/Expense.js";
import DrawerAdjustment from "../models/DrawerAdjustment.js";
import DayClose from "../models/DayClose.js";
import { resolveKarachiDay } from "../lib/businessDay.js";
import { add, subtract, multiply, decimalToString, toDecimal128 } from "../lib/decimal.js";

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Sum a Decimal128 field over a match, returned as a decimal string. */
async function sumField(Model, match, field) {
  const r = await Model.aggregate([{ $match: match }, { $group: { _id: null, s: { $sum: `$${field}` } } }]);
  return r.length ? decimalToString(r[0].s) : "0";
}

const inRange = (start, end) => ({ createdAt: { $gte: start, $lte: end } });

/**
 * Aggregate the cash flows + gross profit for a [start, end] window (ADR-010).
 * Parameterized by range so Phase 6 can reuse it for week/month. Returns decimal
 * strings (whole paisa) — does NOT include starting cash (that's day-specific).
 *
 * NOTE (ADR-009): ALL CustomerPayment/SupplierPayment are counted as cash because
 * the model has no `method` field. When a non-cash path ships, add `method:'cash'`.
 */
export async function aggregateCashFlows({ start, end }) {
  const range = inRange(start, end);

  const [cashSales, customerPayments, supplierPayments, cashRefunds, expenses, drawerIn, drawerOut] =
    await Promise.all([
      sumField(Sale, { paymentType: "cash", voided: false, ...range }, "total"),
      sumField(CustomerPayment, range, "amount"),
      sumField(SupplierPayment, range, "amount"),
      sumField(CustomerReturn, { refundMethod: "cash", ...range }, "total"),
      sumField(Expense, range, "amount"),
      sumField(DrawerAdjustment, { direction: "in", ...range }, "amount"),
      sumField(DrawerAdjustment, { direction: "out", ...range }, "amount"),
    ]);

  // Gross profit: Σ (unitPrice − costAtTime)·qty over non-voided sales in the window…
  const sales = await Sale.find({ voided: false, ...range }).select("lines").lean();
  let grossProfit = "0";
  for (const s of sales) {
    for (const l of s.lines) {
      grossProfit = add(
        grossProfit,
        multiply(subtract(decimalToString(l.unitPrice), decimalToString(l.costAtTime)), decimalToString(l.qty))
      );
    }
  }
  // …minus the profit reversed by returns that happened in THIS window (return hits
  // the day it happened, not the sale's day — §6). costAtTime lives on the sale line.
  const returns = await CustomerReturn.find(range).select("saleId lines").lean();
  if (returns.length) {
    const saleIds = [...new Set(returns.map((r) => String(r.saleId)))];
    const retSales = await Sale.find({ _id: { $in: saleIds } }).select("lines").lean();
    const byKey = new Map(); // `${saleId}:${itemId}` -> { price, cost }
    for (const s of retSales) {
      for (const l of s.lines) {
        byKey.set(`${s._id}:${l.itemId}`, { price: decimalToString(l.unitPrice), cost: decimalToString(l.costAtTime) });
      }
    }
    for (const r of returns) {
      for (const l of r.lines) {
        const m = byKey.get(`${r.saleId}:${l.itemId}`);
        if (m) grossProfit = subtract(grossProfit, multiply(subtract(m.price, m.cost), decimalToString(l.qty)));
      }
    }
  }

  return { cashSales, customerPayments, supplierPayments, cashRefunds, expenses, drawerIn, drawerOut, grossProfit };
}

/** Expected cash = starting + cashSales + customerPayments + drawerIn − cashRefunds − supplierPayments − expenses − drawerOut. */
function computeExpected(startingCash, f) {
  let v = startingCash;
  v = add(v, f.cashSales);
  v = add(v, f.customerPayments);
  v = add(v, f.drawerIn);
  v = subtract(v, f.cashRefunds);
  v = subtract(v, f.supplierPayments);
  v = subtract(v, f.expenses);
  v = subtract(v, f.drawerOut);
  return v;
}

/** Starting cash for a Karachi day = the most recent prior DayClose.actualCash (walk back), else 0. */
async function startingCashFor(dayStart) {
  const prior = await DayClose.findOne({ date: { $lt: dayStart } }).sort({ date: -1 });
  return prior ? decimalToString(prior.actualCash) : "0";
}

const MS_DAY = 86400000;

/**
 * Full daily-close view for a Karachi day (Date | 'YYYY-MM-DD' | undefined=today).
 * Read-only; writes nothing. Surfaces staleness vs a saved close and an
 * un-closed-days hint (§6). Money fields are decimal strings (paisa).
 */
export async function getDayClose(dateInput) {
  const { start, end } = resolveKarachiDay(dateInput);
  const flows = await aggregateCashFlows({ start, end });
  const startingCash = await startingCashFor(start);
  const expectedCash = computeExpected(startingCash, flows);

  const existing = await DayClose.findOne({ date: start });
  let close = null;
  if (existing) {
    const snapshot = decimalToString(existing.expectedCashSnapshot);
    close = {
      actualCash: decimalToString(existing.actualCash),
      expectedCashSnapshot: snapshot,
      differenceSnapshot: decimalToString(existing.differenceSnapshot),
      closedAt: existing.closedAt ?? existing.updatedAt,
      // Stale = the live expected no longer matches what was snapshotted at close
      // (e.g. a retroactive void). actualCash is NEVER recomputed (ADR-009).
      stale: snapshot !== expectedCash,
    };
  }

  // Un-closed-days hint: gap between the most recent prior close and this day (§6).
  const prior = await DayClose.findOne({ date: { $lt: start } }).sort({ date: -1 });
  const gapDays = prior ? Math.round((start.getTime() - prior.date.getTime()) / MS_DAY) : 0;
  const unClosedDays = gapDays > 1 ? gapDays - 1 : 0;

  return {
    date: start,
    startingCash,
    ...flows,
    expectedCash,
    netForDay: subtract(flows.grossProfit, flows.expenses),
    close,
    unClosedDays,
  };
}

/**
 * Upsert the DayClose for a Karachi day (idempotent — keyed on the Karachi day
 * start, so two saves on the same day at different UTC instants make ONE row).
 * Recomputes the expected snapshot fresh; `actualCash` is what the owner counted.
 *
 * @param {Date|string} dateInput
 * @param {object} input - { actualCash (paisa string >= 0), note? }
 * @param {object} ctx - { userId }
 */
export async function saveDayClose(dateInput, input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");
  const { start, end } = resolveKarachiDay(dateInput);

  const flows = await aggregateCashFlows({ start, end });
  const startingCash = await startingCashFor(start);
  const expectedCash = computeExpected(startingCash, flows);
  const actualCash = decimalToString(input.actualCash);
  const difference = subtract(actualCash, expectedCash);

  const doc = await DayClose.findOneAndUpdate(
    { date: start },
    {
      $set: {
        actualCash: toDecimal128(actualCash),
        expectedCashSnapshot: toDecimal128(expectedCash),
        differenceSnapshot: toDecimal128(difference),
        note: input.note,
        closedBy: userId,
      },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
  return doc;
}
