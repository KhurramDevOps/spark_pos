import mongoose from "mongoose";
import Item from "../models/Item.js";
import Supplier from "../models/Supplier.js";
import Purchase from "../models/Purchase.js";
import StockMovement from "../models/StockMovement.js";
// (list/get helpers below; recordPurchase is the transactional core)
import {
  parseDecimal,
  decimalToString,
  toDecimal128,
  add,
  multiply,
  divide,
  round,
  isNegative,
  isZero,
  HALF_EVEN,
} from "../lib/decimal.js";
import { BUNDLE_GAZ } from "../../../shared/inventory/bundle.js";

// avgCost is kept to this many fractional digits of paisa, round-half-even
// (spec 003 / ADR-005). NOT whole-paisa — that would drift COGS.
export const AVG_COST_SCALE = 10;

/**
 * Convert a bundle purchase/opening (spec 011 / ADR-019) — entered as `bundles` +
 * `pricePerBundle` (paisa) — into the CANONICAL per-gaz terms the rest of the system
 * stores. The cost engine, StockMovements, COGS and replay are all per-gaz and stay
 * untouched: the bundle→gaz conversion happens once, here, at the entry boundary.
 *  - qtyGaz         = bundles × 90 (exact)
 *  - unitCostPerGaz = pricePerBundle ÷ 90, Decimal at scale 10 (NOT whole-paisa — that
 *                     would drift ×90; ADR-005). Fed to applyPurchaseToCost / costAtTime.
 *  - payable        = bundles × pricePerBundle, EXACT, decoupled from the rounded per-gaz
 *                     cost — what the supplier is actually owed (ADR-005 money split).
 * @returns {{ qtyGaz: string, unitCostPerGaz: string, payable: string }} decimal strings
 */
export function bundleToGaz(bundles, pricePerBundlePaisa) {
  const B = String(BUNDLE_GAZ);
  return {
    qtyGaz: multiply(bundles, B),
    unitCostPerGaz: divide(pricePerBundlePaisa, B, AVG_COST_SCALE, HALF_EVEN),
    payable: multiply(bundles, pricePerBundlePaisa),
  };
}

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
 * Weighted-average cost for one purchase line, flooring negative stock to 0 in
 * BOTH numerator and denominator (spec 003 §6). The denominator is therefore
 * always > 0 (since purchasedQty > 0), so this never divides by zero.
 * @returns {{ newAvg: string, newStock: string }} both as decimal strings (paisa)
 */
export function applyPurchaseToCost(oldQty, oldAvg, purchasedQty, unitCost) {
  const effectiveOld = isNegative(oldQty) ? "0" : oldQty;
  const numerator = add(
    multiply(effectiveOld, oldAvg),
    multiply(purchasedQty, unitCost)
  );
  const denominator = add(effectiveOld, purchasedQty);
  const newAvg = divide(numerator, denominator, AVG_COST_SCALE, HALF_EVEN);
  const newStock = add(oldQty, purchasedQty); // real arithmetic — may stay negative
  return { newAvg, newStock };
}

/**
 * Record a purchase: increase stock and recompute avgCost for each line, write a
 * `purchase` StockMovement per line, and (if credit) increase the supplier's
 * balance — all in ONE transaction. Item state is read inside the transaction;
 * lines are applied sequentially, so a duplicate item across lines builds on the
 * running value. Posted purchases are immutable (spec 003 §6).
 *
 * Money is in PAISA here. The rupee→paisa conversion happens at the route
 * boundary (shared money validator), not in this service.
 *
 * @param {object} input
 *   - date?            Date (defaults now); a label only — does NOT reorder cost history
 *   - supplierId?      required when paymentType === "credit"
 *   - paymentType      "cash" | "credit"
 *   - lines            [{ itemId, qty (decimal string > 0), unitCost (paisa string >= 0) }]
 *   - note?
 * @param {object} ctx - { userId } (audit; required)
 * @returns {Promise<{ purchase: object, supplier: object|null }>}
 */
export async function recordPurchase(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  const paymentType = input.paymentType;
  if (paymentType !== "cash" && paymentType !== "credit") {
    throw httpError('paymentType must be "cash" or "credit"', 400);
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) throw httpError("a purchase needs at least one line", 400);
  if (paymentType === "credit" && !input.supplierId) {
    throw httpError("a credit purchase requires a supplier (you can't owe nobody)", 400);
  }

  return runInTransaction(async (session) => {
    // Supplier (if any) is loaded and validated inside the transaction.
    let supplier = null;
    if (input.supplierId) {
      supplier = await Supplier.findById(input.supplierId).session(session);
      if (!supplier) throw httpError("supplier not found", 400);
      if (!supplier.isActive) throw httpError("supplier is inactive", 400);
    }

    const itemsById = new Map(); // running item docs within this txn
    const storedLines = [];
    let totalExact = "0";

    for (const [i, line] of lines.entries()) {
      const where = `line ${i + 1}`;

      const qty = parseDecimal(line.qty, `${where} qty`);
      if (isNegative(qty) || isZero(qty)) {
        throw httpError(`${where}: qty must be greater than 0`, 400);
      }
      const unitCost = parseDecimal(line.unitCost, `${where} unitCost`);
      if (isNegative(unitCost)) {
        throw httpError(`${where}: unitCost cannot be negative`, 400);
      }

      // Load the item once per txn; reuse the running doc for duplicate lines so
      // line 2 builds on line 1's updated stock/avg.
      const key = String(line.itemId);
      let item = itemsById.get(key);
      if (!item) {
        item = await Item.findById(line.itemId).session(session);
        if (!item) throw httpError(`${where}: item not found`, 400);
        if (!item.isActive) throw httpError(`${where}: item is inactive (reactivate it first)`, 400);
        itemsById.set(key, item);
      }

      // Bundle item (spec 011): the line was entered as bundles + price-per-bundle.
      // Convert to canonical per-gaz NOW so everything downstream (cost engine, stock,
      // movement, COGS, replay) is unchanged. The payable is the EXACT bundle figure,
      // decoupled from the rounded per-gaz cost (ADR-005). Non-bundle items: unchanged.
      let effQty = qty;
      let effUnitCost = unitCost;
      let lineTotal;
      if (item.bundle) {
        const conv = bundleToGaz(qty, unitCost);
        effQty = conv.qtyGaz;
        effUnitCost = conv.unitCostPerGaz;
        lineTotal = conv.payable;
      } else {
        lineTotal = multiply(qty, unitCost); // paisa, full precision
      }

      const oldQty = decimalToString(item.stockQty);
      const oldAvg = decimalToString(item.avgCost);
      const { newAvg, newStock } = applyPurchaseToCost(oldQty, oldAvg, effQty, effUnitCost);

      item.stockQty = toDecimal128(newStock);
      item.avgCost = toDecimal128(newAvg);

      totalExact = add(totalExact, lineTotal);

      storedLines.push({
        itemId: item._id,
        qty: toDecimal128(effQty),
        unitCost: toDecimal128(effUnitCost),
        lineTotal: toDecimal128(lineTotal),
      });
    }

    // The payable is whole paisa; avgCost above kept full scale.
    const total = round(totalExact, 0, HALF_EVEN);

    const [purchase] = await Purchase.create(
      [
        {
          date: input.date ?? new Date(),
          supplierId: input.supplierId ?? undefined,
          paymentType,
          lines: storedLines,
          total: toDecimal128(total),
          note: input.note,
          createdBy: userId,
        },
      ],
      { session }
    );

    // One purchase StockMovement per line, carrying costAtTime (the unit cost
    // paid) — the audit trail that makes a future replay-based repair possible.
    await StockMovement.create(
      storedLines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        type: "purchase",
        costAtTime: l.unitCost,
        refId: purchase._id,
        createdBy: userId,
      })),
      { session, ordered: true }
    );

    for (const item of itemsById.values()) {
      await item.save({ session });
    }

    if (paymentType === "credit") {
      supplier.balance = toDecimal128(add(decimalToString(supplier.balance), total));
      await supplier.save({ session });
    }

    return { purchase, supplier };
  });
}

/**
 * Purchase history, filterable by supplier and date range, newest first.
 * @param {object} opts - { supplierId, from (Date), to (Date), page, limit }
 */
export async function listPurchases({ supplierId, from, to, page = 1, limit = 20 } = {}) {
  const query = {};
  if (supplierId) query.supplierId = supplierId;
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = from;
    if (to) query.date.$lte = to;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [purchases, total] = await Promise.all([
    Purchase.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("supplierId", "name"),
    Purchase.countDocuments(query),
  ]);

  return { purchases, total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) };
}

/** A single purchase with its lines' items populated. */
export async function getPurchase(id) {
  const purchase = await Purchase.findById(id)
    .populate("supplierId", "name")
    .populate("lines.itemId", "name sku baseUnit");
  if (!purchase) {
    const e = new Error("purchase not found");
    e.status = 404;
    throw e;
  }
  return purchase;
}
