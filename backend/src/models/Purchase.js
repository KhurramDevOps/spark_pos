import mongoose from "mongoose";

const { Schema } = mongoose;

const PAYMENT_TYPES = ["cash", "credit"];

// One line of a purchase. All money in paisa (Decimal128). lineTotal keeps full
// precision (qty·unitCost); the purchase-level `total` is the rounded payable.
const purchaseLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    qty: { type: Schema.Types.Decimal128, required: true }, // item base unit, > 0
    unitCost: { type: Schema.Types.Decimal128, required: true }, // paisa, >= 0
    lineTotal: { type: Schema.Types.Decimal128, required: true }, // paisa, full precision
  },
  { _id: false }
);

/**
 * A posted purchase (spec 003). IMMUTABLE once written — avgCost is path-dependent,
 * so corrections are made via a reversing entry (spec 003b), not by editing. Totals
 * are a historical snapshot computed server-side.
 */
const purchaseSchema = new Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    // Optional — required only for credit (enforced in the service, spec 003 §6).
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
    paymentType: { type: String, required: true, enum: PAYMENT_TYPES },

    lines: {
      type: [purchaseLineSchema],
      required: true,
      validate: { validator: (v) => v.length > 0, message: "a purchase needs at least one line" },
    },

    // The payable: whole paisa (you can't owe a fraction of a paisa).
    total: { type: Schema.Types.Decimal128, required: true },

    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const PURCHASE_PAYMENT_TYPES = PAYMENT_TYPES;
export default mongoose.model("Purchase", purchaseSchema);
