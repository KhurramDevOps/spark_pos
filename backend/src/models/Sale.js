import mongoose from "mongoose";

const { Schema } = mongoose;

const PAYMENT_TYPES = ["cash", "credit"];
const PRICE_MODES = ["retail", "wholesale"];

// One line of a sale (spec 004). All money in paisa (Decimal128). `costAtTime` is
// the item's avgCost snapshotted at the moment of sale — the COGS basis, never
// recomputed. `suggestedPrice` is the server-derived pre-bargain price (for
// discount reporting); `unitPrice` is what was actually charged. lineTotal keeps
// full precision (qty·unitPrice). Below-cost is DERIVED (unitPrice < costAtTime),
// not stored.
const saleLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    qty: { type: Schema.Types.Decimal128, required: true }, // base unit, > 0
    unitPrice: { type: Schema.Types.Decimal128, required: true }, // paisa, >= 0 (0 allowed)
    suggestedPrice: { type: Schema.Types.Decimal128, required: true }, // paisa, server-derived
    costAtTime: { type: Schema.Types.Decimal128, required: true }, // paisa, avgCost snapshot (COGS)
    lineTotal: { type: Schema.Types.Decimal128, required: true }, // paisa, full precision
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
  },
  { timestamps: true }
);

export const SALE_PAYMENT_TYPES = PAYMENT_TYPES;
export const SALE_PRICE_MODES = PRICE_MODES;
export default mongoose.model("Sale", saleSchema);
