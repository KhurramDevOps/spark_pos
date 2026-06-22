import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A payment the shop receives from a customer to reduce their khata (spec 004).
 * Recorded in its own transaction (payment + customer.balance −= amount).
 * Mirrors SupplierPayment.
 */
const customerPaymentSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    amount: { type: Schema.Types.Decimal128, required: true }, // paisa, > 0
    date: { type: Date, required: true, default: Date.now },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("CustomerPayment", customerPaymentSchema);
