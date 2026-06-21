import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A payment the owner makes to a supplier to reduce what's owed (spec 003).
 * Recorded in its own transaction (payment + supplier.balance −= amount).
 */
const supplierPaymentSchema = new Schema(
  {
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    amount: { type: Schema.Types.Decimal128, required: true }, // paisa, > 0
    date: { type: Date, required: true, default: Date.now },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("SupplierPayment", supplierPaymentSchema);
