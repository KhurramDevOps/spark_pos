import mongoose from "mongoose";

const { Schema } = mongoose;

// One line of a supplier return. The stock leaves at the average it was carried
// at, so `costBasis` snapshots the item's avgCost at return time (paisa).
const returnLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    qty: { type: Schema.Types.Decimal128, required: true }, // base unit, > 0
    costBasis: { type: Schema.Types.Decimal128, required: true }, // paisa = avgCost at return
  },
  { _id: false }
);

/**
 * Stock sent back to a supplier (spec 003b). Reduces stock and what's owed; a
 * return does NOT change avgCost (units leave at the current average). If the
 * payable goes negative the supplier owes a refund (`refundDue`). Immutable once
 * recorded (audit).
 */
const supplierReturnSchema = new Schema(
  {
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    date: { type: Date, required: true, default: Date.now },
    lines: {
      type: [returnLineSchema],
      required: true,
      validate: { validator: (v) => v.length > 0, message: "a return needs at least one line" },
    },
    // Total value returned (whole paisa) = Σ qty·costBasis; the amount the payable drops by.
    total: { type: Schema.Types.Decimal128, required: true },
    // True when the return drove the supplier balance negative (already paid → refund owed).
    refundDue: { type: Boolean, default: false },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("SupplierReturn", supplierReturnSchema);
