import mongoose from "mongoose";

const { Schema } = mongoose;

const PAYMENT_TYPES = ["cash", "credit"];
const PRICE_MODES = ["retail", "wholesale"];

// One line of a sale. Polymorphic on `kind` (spec 008 / ADR-016):
//   - "item"  (default; spec 004): a catalogued Item. Carries `itemId`,
//     `suggestedPrice`, and `costAtTime` — the avgCost snapshot at sale time, the
//     COGS basis, never recomputed. Below-cost is DERIVED (unitPrice < costAtTime).
//   - "quick" (spec 008): an uncatalogued good typed at checkout (screws, etc.).
//     Carries a free-text `name` and NO cost basis — `itemId`/`costAtTime`/
//     `suggestedPrice` are ABSENT (not zero). A quick line has real revenue but an
//     unknown cost, so it must never be summed into COGS gross profit (ADR-016).
// All money in paisa (Decimal128). `unitPrice` is what was charged; `lineTotal`
// keeps full precision (qty·unitPrice). Both kinds carry qty/unitPrice/lineTotal.
const isItemLine = function () {
  return this.kind === "item";
};
const isQuickLine = function () {
  return this.kind === "quick";
};
const saleLineSchema = new Schema(
  {
    kind: { type: String, enum: ["item", "quick"], default: "item", required: true },
    qty: { type: Schema.Types.Decimal128, required: true }, // base unit, > 0
    unitPrice: { type: Schema.Types.Decimal128, required: true }, // paisa, >= 0 (0 allowed)
    lineTotal: { type: Schema.Types.Decimal128, required: true }, // paisa, full precision

    // item-kind only (required when kind === "item", absent for quick):
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: isItemLine },
    suggestedPrice: { type: Schema.Types.Decimal128, required: isItemLine }, // paisa, server-derived
    costAtTime: { type: Schema.Types.Decimal128, required: isItemLine }, // paisa, avgCost snapshot (COGS)

    // quick-kind only (required when kind === "quick", absent for item):
    name: { type: String, trim: true, minlength: 1, maxlength: 120, required: isQuickLine },
  },
  { _id: false }
);

/**
 * A posted sale (spec 004). IMMUTABLE once written — like Purchase. Profit is
 * realised here: each line locks `costAtTime`, so profit = (unitPrice − costAtTime)
 * × qty is a stored, drift-free number. A sale does NOT change avgCost. Corrections
 * are made via a return/void (spec 004b), not by editing. No sale-level discount —
 * bargaining is per-line via unitPrice (ADR-007).
 */
const saleSchema = new Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    // Optional — required only for credit (enforced in the service, spec 004 §6).
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    paymentType: { type: String, required: true, enum: PAYMENT_TYPES },
    priceMode: { type: String, required: true, enum: PRICE_MODES },

    lines: {
      type: [saleLineSchema],
      required: true,
      validate: { validator: (v) => v.length > 0, message: "a sale needs at least one line" },
    },

    // The amount due: whole paisa (Σ lineTotal, rounded). Snapshot, computed server-side.
    total: { type: Schema.Types.Decimal128, required: true },

    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // Void audit (spec 004b). A voided sale is never deleted; its stock is put
    // back and its khata effect undone, and it's marked here so it can't be voided
    // twice and reads as voided in history.
    voided: { type: Boolean, default: false },
    voidedAt: { type: Date },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const SALE_PAYMENT_TYPES = PAYMENT_TYPES;
export const SALE_PRICE_MODES = PRICE_MODES;
export default mongoose.model("Sale", saleSchema);
