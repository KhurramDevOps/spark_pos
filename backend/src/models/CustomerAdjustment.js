import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A recorded correction to a customer's khata balance (spec 010 / ADR-018). NOT a
 * payment — it is money the books were wrong about, not money through the drawer, so
 * it is a SEPARATE collection that the daily-close cash math never reads (the cash/
 * correction firewall). `amount` is SIGNED paisa: positive increases what the customer
 * owes, negative decreases it; `customer.balance += amount` in the same transaction.
 * Append-only and immutable — a wrong adjustment is fixed by another adjustment, never
 * edited. The required `reason` is the audit trail. Mirrors CustomerPayment's shape.
 */
const customerAdjustmentSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    amount: { type: Schema.Types.Decimal128, required: true }, // signed paisa, non-zero
    reason: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    date: { type: Date, required: true, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("CustomerAdjustment", customerAdjustmentSchema);
