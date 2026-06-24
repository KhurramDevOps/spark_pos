import mongoose from "mongoose";
import Item from "../models/Item.js";
import StockMovement from "../models/StockMovement.js";
import { applyPurchaseToCost } from "./purchaseService.js";
import { add, decimalToString, toDecimal128, isNegative, isZero, parseDecimal } from "../lib/decimal.js";

// The exact shape today's (pre-006c) createItem wrote opening stock as: a
// cost-less `adjustment` noted "opening stock". The repair tool MUST delete this
// alongside any real `opening` movement, or the new opening stacks on top of it
// and replay double-counts stock (spec 006c §10 — the bug this slice exists to fix).
const LEGACY_OPENING_NOTE = "opening stock";

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

/**
 * Owner-only repair tool (spec 006c §4 path #4 / ADR-013): declare the correct
 * opening cost for an item whose avgCost is wrong — typically one entered before
 * this spec with cost = 0, then diluted by a later real purchase.
 *
 * The whole repair is ONE transaction:
 *   1. Delete any existing `type: 'opening'` movement for the item (replace, not
 *      stack — there is only ever one opening per item afterward).
 *   2. Delete any LEGACY `type: 'adjustment'` movement noted "opening stock" — the
 *      shape pre-006c createItem wrote. Skipping this is the §10 double-count bug:
 *      the new opening would add ON TOP of the legacy qty (15 → 45), not replace it.
 *   3. Create the new `opening` movement (costAtTime = the corrected unit cost),
 *      slotted as the FIRST event: createdAt = (earliest REMAINING movement.createdAt
 *      − 1ms), or now if none. Mongo Date is ms-resolution, so −1ms is a strictly
 *      smaller, distinct timestamp that sorts first by the primary key (§6).
 *   4. Replay via the PURE recomputeItemCostByReplay(itemId, { session }) — NOT the
 *      recalculateItemCost wrapper, which would open its own nested transaction —
 *      and persist the recomputed avgCost + stockQty to the Item, same session.
 *
 * No supplier, no cash, no customer is touched: an opening is an inventory + cost
 * declaration, not a purchase (ADR-013).
 *
 * @param {string} itemId
 * @param {object} input - { unitCost (paisa decimal string, >= 0), qty? (decimal
 *   string > 0; defaults to the item's current stockQty), note (required) }
 * @param {object} ctx - { userId } (audit; required)
 * @returns {Promise<{ itemId, before, after, changed: boolean, item: object }>}
 */
export async function repairOpeningCost(itemId, input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  // Note is mandatory for a repair — the owner must explain why (spec §7).
  const note = input.note != null ? String(input.note).trim() : "";
  if (!note) {
    const e = new Error("a note is required to repair opening cost");
    e.status = 400;
    throw e;
  }

  // Unit cost: paisa decimal string, >= 0 (zero allowed — genuinely-free stock).
  const unitCost = parseDecimal(input.unitCost, "unitCost");
  if (isNegative(unitCost)) {
    const e = new Error("unitCost cannot be negative");
    e.status = 400;
    throw e;
  }

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

      // Qty defaults to the item's current stockQty (editable in case it's also
      // wrong); must be strictly positive (an opening declares stock you HAVE).
      const hasQty = input.qty != null && String(input.qty).trim() !== "";
      const qty = parseDecimal(hasQty ? input.qty : decimalToString(item.stockQty), "qty");
      if (isNegative(qty) || isZero(qty)) {
        const e = new Error("qty must be greater than 0");
        e.status = 400;
        throw e;
      }

      const before = {
        avgCost: decimalToString(item.avgCost),
        stockQty: decimalToString(item.stockQty),
      };

      // 1 + 2: remove BOTH the real opening and the legacy adjustment-"opening
      // stock" shape, so the new opening replaces (never stacks on) either one.
      await StockMovement.deleteMany(
        {
          itemId: item._id,
          $or: [
            { type: "opening" },
            { type: "adjustment", note: LEGACY_OPENING_NOTE },
          ],
        },
        { session }
      );

      // 3: slot the new opening just before the earliest REMAINING movement so the
      // replay sees it as the first event. Compute min AFTER the deletion above.
      const [earliest] = await StockMovement.find({ itemId: item._id })
        .sort({ createdAt: 1, _id: 1 })
        .limit(1)
        .select("createdAt")
        .session(session)
        .lean();
      const createdAt = earliest ? new Date(earliest.createdAt.getTime() - 1) : new Date();

      await StockMovement.create(
        [
          {
            itemId: item._id,
            qty,
            type: "opening",
            costAtTime: unitCost,
            note,
            createdBy: userId,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        // timestamps:false so Mongoose honours our explicit createdAt instead of
        // stamping now() (which would sort the opening LAST, not first).
        { session, timestamps: false }
      );

      // 4: PURE replay + persist, all in this same session (NOT recalculateItemCost,
      // which would nest its own transaction).
      const after = await recomputeItemCostByReplay(item._id, { session });
      const changed = after.avgCost !== before.avgCost || after.stockQty !== before.stockQty;

      item.avgCost = toDecimal128(after.avgCost);
      item.stockQty = toDecimal128(after.stockQty);
      await item.save({ session });

      result = { itemId: String(item._id), before, after, changed, item };
    });
    return result;
  } finally {
    await session.endSession();
  }
}
