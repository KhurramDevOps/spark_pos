import mongoose from "mongoose";
import Item from "../models/Item.js";
import Customer from "../models/Customer.js";
import Sale from "../models/Sale.js";
import CustomerReturn from "../models/CustomerReturn.js";
import StockMovement from "../models/StockMovement.js";
import {
  parseDecimal,
  decimalToString,
  toDecimal128,
  add,
  subtract,
  multiply,
  round,
  isNegative,
  isZero,
  HALF_EVEN,
} from "../lib/decimal.js";

/** Run `fn(session)` inside a single MongoDB transaction (golden rule #3). */
async function runInTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Void a whole posted sale (spec 004b): put its stock back and undo its khata
 * effect, in one transaction. STOCK-ONLY — a sale never changed avgCost, so there
 * is no replay/recompute (ADR-008). Writes a `reversal` StockMovement (POSITIVE
 * qty) per line, `reversalRef` left unset. The sale is marked voided (never
 * deleted) and cannot be voided twice.
 *
 * @param {string} saleId
 * @param {object} ctx - { userId }
 * @returns {Promise<{ sale, customer: object|null, items: object[] }>}
 */
export async function voidSale(saleId, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  return runInTransaction(async (session) => {
    const sale = await Sale.findById(saleId).session(session);
    if (!sale) throw httpError("sale not found", 404);
    if (sale.voided) throw httpError("sale is already voided", 400);

    // Voiding a partially-returned sale would restore the FULL original stock while
    // the returned units' stock was already added back — a silent double-count
    // (recalculate-cost can't catch a qty bug). Block it; the owner must reverse the
    // returns first. Same precondition pattern as the no-double-void guard (ADR-008).
    const returnCount = await CustomerReturn.countDocuments({ saleId: sale._id }).session(session);
    if (returnCount > 0) {
      throw httpError(
        "this sale has returns recorded against it — reverse the returns first to void it",
        400
      );
    }

    // Quick lines (spec 008) have no item/stock — they were never decremented, so
    // there is nothing to put back. Void reverses their cash/khata via sale.total
    // (below), but skips them here. (`!== "quick"` treats legacy lines, which
    // predate `kind`, as item lines.)
    const itemLines = sale.lines.filter((l) => l.kind !== "quick");

    // Reversing rows: positive qty back in, type "reversal", costAtTime carried
    // for audit only (never recomputes avg), reversalRef intentionally UNSET.
    if (itemLines.length > 0) {
      await StockMovement.create(
        itemLines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty, // positive — stock back in
          type: "reversal",
          costAtTime: l.costAtTime,
          refId: sale._id,
          createdBy: userId,
        })),
        { session, ordered: true }
      );
    }

    // Add stock back per affected item (a sale may repeat an item across lines).
    const addedByItem = new Map();
    for (const l of itemLines) {
      const key = String(l.itemId);
      addedByItem.set(key, add(addedByItem.get(key) ?? "0", decimalToString(l.qty)));
    }
    const items = [];
    for (const [key, added] of addedByItem) {
      const item = await Item.findById(key).session(session);
      if (!item) throw httpError("item on the sale no longer exists", 400);
      item.stockQty = toDecimal128(add(decimalToString(item.stockQty), added));
      await item.save({ session });
      items.push(item);
    }

    // Undo the khata effect of a credit sale (cash has none). May go negative
    // (already paid → store credit) — allowed + surfaced.
    let customer = null;
    if (sale.paymentType === "credit" && sale.customerId) {
      customer = await Customer.findById(sale.customerId).session(session);
      if (customer) {
        customer.balance = toDecimal128(
          subtract(decimalToString(customer.balance), decimalToString(sale.total))
        );
        await customer.save({ session });
      }
    }

    sale.voided = true;
    sale.voidedAt = new Date();
    sale.voidedBy = userId;
    await sale.save({ session });

    return { sale, customer, items };
  });
}

/** Returns recorded against a sale (for the cumulative qty cap + history). */
export async function listCustomerReturnsForSale(saleId) {
  return CustomerReturn.find({ saleId })
    .sort({ date: -1, createdAt: -1 })
    .populate("lines.itemId", "name sku baseUnit");
}

/**
 * Record a customer return (spec 004b). Always linked to a sale. Puts stock back
 * and refunds cash (a record) or credits the khata (customer.balance -= total).
 * STOCK-ONLY — no replay (ADR-008). The customer is refunded what they PAID
 * (valueAtTime = the sale line's unitPrice). Returned qty is capped cumulatively
 * at what was sold on the linked sale's line for that item.
 *
 * @param {object} input - { saleId, customerId?, date?, lines:[{itemId, qty}], refundMethod, note? }
 * @param {object} ctx - { userId }
 * @returns {Promise<{ customerReturn, customer: object|null, items: object[] }>}
 */
export async function recordCustomerReturn(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");
  if (!input.saleId) throw httpError("a return must be linked to a sale", 400);
  const refundMethod = input.refundMethod;
  if (refundMethod !== "cash" && refundMethod !== "khata-credit") {
    throw httpError('refundMethod must be "cash" or "khata-credit"', 400);
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) throw httpError("a return needs at least one line", 400);

  return runInTransaction(async (session) => {
    const sale = await Sale.findById(input.saleId).session(session);
    if (!sale) throw httpError("sale not found", 400);
    if (sale.voided) throw httpError("cannot return against a voided sale", 400);

    // Per-item snapshot from the sale: sold qty, the price paid, and the COGS cost.
    const sold = new Map(); // itemId -> { soldQty, unitPrice, costAtTime }
    for (const l of sale.lines) {
      const key = String(l.itemId);
      const prev = sold.get(key);
      const q = decimalToString(l.qty);
      sold.set(key, {
        soldQty: add(prev?.soldQty ?? "0", q),
        unitPrice: prev?.unitPrice ?? decimalToString(l.unitPrice),
        costAtTime: prev?.costAtTime ?? decimalToString(l.costAtTime),
      });
    }

    // Already-returned qty per item against this sale (cumulative cap).
    const prior = await CustomerReturn.find({ saleId: sale._id }).session(session);
    const returnedSoFar = new Map();
    for (const r of prior) {
      for (const l of r.lines) {
        const key = String(l.itemId);
        returnedSoFar.set(key, add(returnedSoFar.get(key) ?? "0", decimalToString(l.qty)));
      }
    }

    const addedByItem = new Map();
    const storedLines = [];
    let totalExact = "0";

    for (const [i, line] of lines.entries()) {
      const where = `line ${i + 1}`;
      const qty = parseDecimal(line.qty, `${where} qty`);
      if (isNegative(qty) || isZero(qty)) throw httpError(`${where}: qty must be greater than 0`, 400);

      const key = String(line.itemId);
      const s = sold.get(key);
      if (!s) throw httpError(`${where}: that item was not on this sale`, 400);

      // Cumulative cap: prior returns + this one must not exceed what was sold.
      const cumulative = add(returnedSoFar.get(key) ?? "0", qty);
      if (isNegative(subtract(s.soldQty, cumulative))) {
        throw httpError(
          `${where}: returning more than was sold (sold ${s.soldQty}, already returned ${returnedSoFar.get(key) ?? "0"})`,
          400
        );
      }
      returnedSoFar.set(key, cumulative);

      totalExact = add(totalExact, multiply(qty, s.unitPrice));
      addedByItem.set(key, { qty: add(addedByItem.get(key)?.qty ?? "0", qty), costAtTime: s.costAtTime });
      storedLines.push({ itemId: line.itemId, qty: toDecimal128(qty), valueAtTime: toDecimal128(s.unitPrice) });
    }

    const total = round(totalExact, 0, HALF_EVEN);

    // khata-credit needs a customer (the sale's, or one supplied for a cash sale).
    let customer = null;
    let customerId;
    if (refundMethod === "khata-credit") {
      customerId = input.customerId ?? (sale.customerId ? String(sale.customerId) : undefined);
      if (!customerId) throw httpError("khata-credit refund requires a customer", 400);
      customer = await Customer.findById(customerId).session(session);
      if (!customer) throw httpError("customer not found", 400);
    }

    const [customerReturn] = await CustomerReturn.create(
      [
        {
          saleId: sale._id,
          customerId: customerId ?? undefined,
          date: input.date ?? new Date(),
          lines: storedLines,
          total: toDecimal128(total),
          refundMethod,
          note: input.note,
          createdBy: userId,
        },
      ],
      { session }
    );

    // Stock back in: positive qty, type "return", costAtTime carried for audit.
    await StockMovement.create(
      Array.from(addedByItem.entries()).map(([key, v]) => ({
        itemId: key,
        qty: toDecimal128(v.qty),
        type: "return",
        costAtTime: toDecimal128(v.costAtTime),
        refId: customerReturn._id,
        createdBy: userId,
      })),
      { session, ordered: true }
    );

    const items = [];
    for (const [key, v] of addedByItem) {
      const item = await Item.findById(key).session(session);
      if (!item) throw httpError("returned item no longer exists", 400);
      item.stockQty = toDecimal128(add(decimalToString(item.stockQty), v.qty));
      await item.save({ session });
      items.push(item);
    }

    if (refundMethod === "khata-credit") {
      customer.balance = toDecimal128(subtract(decimalToString(customer.balance), total));
      await customer.save({ session });
    }

    return { customerReturn, customer, items };
  });
}
