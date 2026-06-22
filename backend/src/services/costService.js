import StockMovement from "../models/StockMovement.js";
import { applyPurchaseToCost } from "./purchaseService.js";
import { add, decimalToString, isNegative } from "../lib/decimal.js";

/**
 * Recompute an item's weighted-average cost AND a verified stock quantity by
 * REPLAYING its full movement history — the only correct way to fix avgCost after
 * a reversal/return, since a weighted average can't be un-averaged (ADR-006).
 *
 * The rule (spec 003b §2/§6):
 *   - Walk ALL of the item's movements in posting order — purchase, adjustment
 *     (incl. opening stock), sale, return, reversal — keeping a running
 *     (stockQty, avgCost) from (0, 0).
 *   - At a `purchase` movement (the only cost-bearing event) recompute the
 *     average via `applyPurchaseToCost` (spec 003 §6 floored-weighted-average,
 *     reused VERBATIM — one avgCost code path).
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
  const exclude = new Set(excludeRefIds.map((id) => String(id)));

  const query = StockMovement.find({ itemId })
    .sort({ createdAt: 1, _id: 1 })
    .select("type qty costAtTime refId reversalRef")
    .lean();
  if (session) query.session(session);
  const movements = await query;

  let runQty = "0";
  let runAvg = "0";

  for (const mv of movements) {
    // Drop a reversed purchase's rows and their reversing pair (exclude, don't subtract).
    if (exclude.size > 0) {
      const ref = mv.refId != null ? String(mv.refId) : null;
      const rref = mv.reversalRef != null ? String(mv.reversalRef) : null;
      if ((ref && exclude.has(ref)) || (rref && exclude.has(rref))) continue;
    }

    const qty = decimalToString(mv.qty);

    if (mv.type === "purchase") {
      // A cost-bearing movement with no (or negative) cost is corruption —
      // surface it loudly, never silently treat as 0 (ADR-006 guard).
      if (mv.costAtTime == null) {
        throw new Error(`replay: purchase movement ${mv._id} is missing costAtTime`);
      }
      const cost = decimalToString(mv.costAtTime);
      if (isNegative(cost)) {
        throw new Error(`replay: purchase movement ${mv._id} has a negative costAtTime (${cost})`);
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
