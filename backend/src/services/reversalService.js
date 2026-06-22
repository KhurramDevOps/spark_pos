import mongoose from "mongoose";
import Item from "../models/Item.js";
import Supplier from "../models/Supplier.js";
import Purchase from "../models/Purchase.js";
import StockMovement from "../models/StockMovement.js";
import SupplierReturn from "../models/SupplierReturn.js";
import { recomputeItemCostByReplay } from "./costService.js";
import {
  decimalToString,
  toDecimal128,
  add,
  subtract,
  multiply,
  round,
  parseDecimal,
  isNegative,
  isZero,
  HALF_EVEN,
} from "../lib/decimal.js";

const negate = (d) => subtract("0", d);

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
 * Reverse a whole posted purchase (spec 003b): undo its stock, restore the
 * supplier payable (credit only), and CORRECT avgCost — all in one transaction.
 *
 * avgCost is fixed by REPLAY, never by an inverse formula (ADR-006): for every
 * affected item we recompute from its movement history while EXCLUDING this
 * purchase's rows and their reversing pair (`excludeRefIds: [purchase._id]`).
 * The reversing StockMovements (negative qty, type "reversal") are still written
 * for the stock ledger + audit; they're just filtered out of the average.
 *
 * Posted purchases stay immutable; the purchase is marked `reversed` (never
 * deleted) and cannot be reversed twice.
 *
 * @param {string} purchaseId
 * @param {object} ctx - { userId } (audit; required)
 * @returns {Promise<{ purchase, supplier: object|null, items: object[] }>}
 */
export async function reversePurchase(purchaseId, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  return runInTransaction(async (session) => {
    const purchase = await Purchase.findById(purchaseId).session(session);
    if (!purchase) throw httpError("purchase not found", 404);
    if (purchase.reversed) throw httpError("purchase is already reversed", 400);

    // Reversing ledger rows: negative qty, distinct "reversal" type, carrying the
    // original unit cost and linked to the purchase via refId + reversalRef so the
    // replay can drop the original+reversal pair together.
    const reversingRows = purchase.lines.map((l) => ({
      itemId: l.itemId,
      qty: toDecimal128(negate(decimalToString(l.qty))),
      type: "reversal",
      costAtTime: l.unitCost,
      refId: purchase._id,
      reversalRef: purchase._id,
      createdBy: userId,
    }));
    await StockMovement.create(reversingRows, { session, ordered: true });

    // Total qty removed per affected item (a purchase may repeat an item across lines).
    const removedByItem = new Map();
    for (const l of purchase.lines) {
      const key = String(l.itemId);
      removedByItem.set(key, add(removedByItem.get(key) ?? "0", decimalToString(l.qty)));
    }

    // Replay-recompute avgCost + stockQty for each affected item, excluding this
    // purchase. Assert the recomputed stock matches the expected post-reversal
    // value (cached − removed) as a drift guard before committing.
    const items = [];
    for (const [itemKey, removed] of removedByItem) {
      const item = await Item.findById(itemKey).session(session);
      if (!item) throw httpError("item on the purchase no longer exists", 400);

      const expectedStock = subtract(decimalToString(item.stockQty), removed);
      const { avgCost, stockQty } = await recomputeItemCostByReplay(item._id, {
        session,
        excludeRefIds: [purchase._id],
      });
      if (stockQty !== expectedStock) {
        throw httpError(
          `reversal stock drift on item ${item._id}: replay ${stockQty} != expected ${expectedStock}`,
          500
        );
      }

      item.stockQty = toDecimal128(stockQty);
      item.avgCost = toDecimal128(avgCost);
      await item.save({ session });
      items.push(item);
    }

    // Restore the supplier payable for a credit purchase (cash has no effect).
    // May push the balance negative if already paid (advance / refund due) — allowed.
    let supplier = null;
    if (purchase.paymentType === "credit" && purchase.supplierId) {
      supplier = await Supplier.findById(purchase.supplierId).session(session);
      if (supplier) {
        supplier.balance = toDecimal128(
          subtract(decimalToString(supplier.balance), decimalToString(purchase.total))
        );
        await supplier.save({ session });
      }
    }

    purchase.reversed = true;
    purchase.reversedAt = new Date();
    purchase.reversedBy = userId;
    await purchase.save({ session });

    return { purchase, supplier, items };
  });
}

/**
 * Record a supplier return (spec 003b): send some stock back, reduce what's owed,
 * in one transaction. A return does NOT change avgCost — the units leave at the
 * current average (captured per line as `costBasis`); only stock drops. avgCost +
 * stockQty are still corrected via the one replay path (avg comes out unchanged,
 * stock comes out reduced), with a drift guard.
 *
 * Reducing the payable can drive the balance negative (you'd already paid) — that
 * negative balance is the refund due; `refundDue` is flagged. Returns may drive
 * stock negative — allowed + surfaced, never blocked.
 *
 * @param {object} input - { supplierId, date?, lines:[{ itemId, qty (decimal string > 0) }], note? }
 * @param {object} ctx - { userId } (audit; required)
 * @returns {Promise<{ supplierReturn, supplier, items: object[] }>}
 */
export async function recordSupplierReturn(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");
  if (!input.supplierId) throw httpError("a supplier return requires a supplier", 400);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) throw httpError("a return needs at least one line", 400);

  return runInTransaction(async (session) => {
    const supplier = await Supplier.findById(input.supplierId).session(session);
    if (!supplier) throw httpError("supplier not found", 400);

    const itemsById = new Map();
    const removedByItem = new Map();
    const storedLines = [];
    let totalExact = "0";

    for (const [i, line] of lines.entries()) {
      const where = `line ${i + 1}`;
      const qty = parseDecimal(line.qty, `${where} qty`);
      if (isNegative(qty) || isZero(qty)) throw httpError(`${where}: qty must be greater than 0`, 400);

      const key = String(line.itemId);
      let item = itemsById.get(key);
      if (!item) {
        item = await Item.findById(line.itemId).session(session);
        if (!item) throw httpError(`${where}: item not found`, 400);
        itemsById.set(key, item);
      }

      // Units leave at the average they're carried at (return-at-current-avg).
      const costBasis = decimalToString(item.avgCost);
      totalExact = add(totalExact, multiply(qty, costBasis));
      removedByItem.set(key, add(removedByItem.get(key) ?? "0", qty));
      storedLines.push({ itemId: item._id, qty: toDecimal128(qty), costBasis: toDecimal128(costBasis) });
    }

    // The credit to the payable is whole paisa.
    const total = round(totalExact, 0, HALF_EVEN);

    // Create the return doc first so the ledger rows can reference it.
    const [supplierReturn] = await SupplierReturn.create(
      [
        {
          supplierId: supplier._id,
          date: input.date ?? new Date(),
          lines: storedLines,
          total: toDecimal128(total),
          refundDue: false, // set once the balance is moved
          note: input.note,
          createdBy: userId,
        },
      ],
      { session }
    );

    // Reduce-stock ledger rows: negative qty, type "return", costAtTime = costBasis.
    await StockMovement.create(
      storedLines.map((l) => ({
        itemId: l.itemId,
        qty: toDecimal128(negate(decimalToString(l.qty))),
        type: "return",
        costAtTime: l.costBasis,
        refId: supplierReturn._id,
        createdBy: userId,
      })),
      { session, ordered: true }
    );

    // Replay each affected item (avg unchanged; stock dropped) with a drift guard.
    const items = [];
    for (const [key, removed] of removedByItem) {
      const item = itemsById.get(key);
      const expectedStock = subtract(decimalToString(item.stockQty), removed);
      const { avgCost, stockQty } = await recomputeItemCostByReplay(item._id, { session });
      if (stockQty !== expectedStock) {
        throw httpError(
          `return stock drift on item ${item._id}: replay ${stockQty} != expected ${expectedStock}`,
          500
        );
      }
      item.stockQty = toDecimal128(stockQty);
      item.avgCost = toDecimal128(avgCost);
      await item.save({ session });
      items.push(item);
    }

    // Reduce the payable; a negative balance is the refund due (already paid).
    const newBalance = subtract(decimalToString(supplier.balance), total);
    supplier.balance = toDecimal128(newBalance);
    await supplier.save({ session });

    supplierReturn.refundDue = isNegative(newBalance);
    await supplierReturn.save({ session });

    return { supplierReturn, supplier, items };
  });
}
