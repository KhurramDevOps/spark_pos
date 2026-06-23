import mongoose from "mongoose";
import Item from "../models/Item.js";
import StockMovement from "../models/StockMovement.js";
import { applyPurchaseToCost } from "./purchaseService.js";
import { add, decimalToString, toDecimal128, isNegative } from "../lib/decimal.js";

// Movement types that bear cost and drive the weighted-average recompute. Opening
// stock (ADR-013) joins purchase here; all other types are qty-only in replay.
const COST_BEARING = new Set(["purchase", "opening"]);

/**
 * Recompute an item's weighted-average cost AND a verified stock quantity by
 * REPLAYING its full movement history — the only correct way to fix avgCost after
 * a reversal/return, since a weighted average can't be un-averaged (ADR-006).
 *
 * The rule (spec 003b §2/§6, extended by spec 006c / ADR-013):
 *   - Walk ALL of the item's movements in posting order — purchase, opening,
 *     sale, return, adjustment, reversal — keeping a running (stockQty, avgCost)
 *     from (0, 0).
 *   - At a COST-BEARING movement (`purchase` OR `opening` — see COST_BEARING)
 *     recompute the average via `applyPurchaseToCost` (spec 003 §6 floored-
 *     weighted-average, reused VERBATIM — one avgCost code path). `opening`
 *     declares pre-existing stock at its real cost and is treated identically to
 *     a purchase for cost; it just has no supplier/cash side (ADR-013).
 *   - At every other movement type, apply the signed qty to running stock and
 *     leave avgCost unchanged.
 *
 * Ordering key is (createdAt asc, _id asc) — NEVER purchase.date, which is a
 * label that must not reorder cost history. `_id` is the tiebreak for movements
 * sharing a createdAt (e.g. two same-item lines of one purchase).
 *
 * "Exclude, don't subtract": to model a reversed purchase, pass its id in
 * `excludeRefIds`; every movement whose `refId` OR `reversalRef` matches is
 * dropped (the original rows and their reversing pair cancel), and the average
 * is recomputed from the survivors. We never feed a negative qty into the
 * average formula.
 *
 * This function is PURE: it reads movements and returns the result; it does not
 * write the item. Callers (reverse/return flows, the repair tool) apply it and
 * run the drift check (recomputed stockQty vs cached).
 *
 * @param {import("mongoose").Types.ObjectId|string} itemId
 * @param {object} [opts]
 * @param {import("mongoose").ClientSession} [opts.session]
 * @param {Array<string|object>} [opts.excludeRefIds] - purchase ids to exclude
 * @returns {Promise<{ avgCost: string, stockQty: string }>} decimal strings (paisa / qty)
 */
export async function recomputeItemCostByReplay(itemId, { session, excludeRefIds = [] } = {}) {
  const query = StockMovement.find({ itemId })
    .sort({ createdAt: 1, _id: 1 })
    .select("type qty costAtTime refId reversalRef")
    .lean();
  if (session) query.session(session);
  const movements = await query;

  // Reversed purchases never contribute to cost. They are SELF-DESCRIBING in the
  // ledger: every reversing row carries `reversalRef = the reversed purchase id`.
  // So we derive the exclusion set from the movements themselves (plus any ids the
  // caller passed for an in-flight reversal), and drop each reversed purchase's
  // original rows AND their reversing pair ("exclude, don't subtract" — ADR-006).
  // Without this, a standalone recompute would replay a reversed purchase's cost
  // back in and silently undo the reversal's avgCost correction.
  const exclude = new Set(excludeRefIds.map((id) => String(id)));
  for (const mv of movements) {
    if (mv.reversalRef != null) exclude.add(String(mv.reversalRef));
  }

  let runQty = "0";
  let runAvg = "0";

  for (const mv of movements) {
    if (exclude.size > 0) {
      const ref = mv.refId != null ? String(mv.refId) : null;
      const rref = mv.reversalRef != null ? String(mv.reversalRef) : null;
      if ((ref && exclude.has(ref)) || (rref && exclude.has(rref))) continue;
    }

    const qty = decimalToString(mv.qty);

    if (COST_BEARING.has(mv.type)) {
      // A cost-bearing movement (purchase or opening) with no (or negative) cost
      // is corruption — surface it loudly, never silently treat as 0 (ADR-006 guard).
      if (mv.costAtTime == null) {
        throw new Error(`replay: ${mv.type} movement ${mv._id} is missing costAtTime`);
      }
      const cost = decimalToString(mv.costAtTime);
      if (isNegative(cost)) {
        throw new Error(`replay: ${mv.type} movement ${mv._id} has a negative costAtTime (${cost})`);
      }
      const { newAvg, newStock } = applyPurchaseToCost(runQty, runAvg, qty, cost);
      runAvg = newAvg;
      runQty = newStock;
    } else {
      // adjustment / sale / return / reversal: stock-only, avg unchanged.
      runQty = add(runQty, qty);
    }
  }

  return { avgCost: runAvg, stockQty: runQty };
}

/**
 * Owner-only repair tool (spec 003b §9.6): re-derive an item's avgCost + stockQty
 * from its full movement history and write the corrected values, returning a drift
 * report. A general integrity valve — same replay engine, no second cost path.
 *
 * @param {string} itemId
 * @param {object} ctx - { userId } (audit; required)
 * @returns {Promise<{ itemId, before, after, changed: boolean, item: object }>}
 */
export async function recalculateItemCost(itemId, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const item = await Item.findById(itemId).session(session);
      if (!item) {
        const e = new Error("item not found");
        e.status = 404;
        throw e;
      }

      const before = { avgCost: decimalToString(item.avgCost), stockQty: decimalToString(item.stockQty) };
      const after = await recomputeItemCostByReplay(item._id, { session });
      const changed = after.avgCost !== before.avgCost || after.stockQty !== before.stockQty;

      if (changed) {
        item.avgCost = toDecimal128(after.avgCost);
        item.stockQty = toDecimal128(after.stockQty);
        await item.save({ session });
      }

      result = { itemId: String(item._id), before, after, changed, item };
    });
    return result;
  } finally {
    await session.endSession();
  }
}
