import mongoose from "mongoose";

const { Schema } = mongoose;

const REFUND_METHODS = ["cash", "khata-credit"];

// One line of a customer return. The customer gets back what they PAID, so
// `valueAtTime` snapshots the original sale line's unitPrice (paisa).
const returnLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    qty: { type: Schema.Types.Decimal128, required: true }, // base unit, > 0
    valueAtTime: { type: Schema.Types.Decimal128, required: true }, // paisa = original unitPrice
  },
  { _id: false }
);

/**
 * Stock a customer brought back (spec 004b). Always linked to the original Sale.
 * Increases stock and refunds cash (a record) or credits the khata
 * (customer.balance -= total). A return does NOT touch avgCost. Immutable (audit).
 * Mirrors SupplierReturn structurally — but stock goes IN, and there is no replay.
 */
const customerReturnSchema = new Schema(
  {
    saleId: { type: Schema.Types.ObjectId, ref: "Sale", required: true },
    // Required only for khata-credit (a cash sale may have had no customer).
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    date: { type: Date, required: true, default: Date.now },
    lines: {
      type: [returnLineSchema],
      required: true,
      validate: { validator: (v) => v.length > 0, message: "a return needs at least one line" },
    },
    // Refund/credit value (whole paisa) = Σ qty·valueAtTime.
    total: { type: Schema.Types.Decimal128, required: true },
    refundMethod: { type: String, required: true, enum: REFUND_METHODS },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const CUSTOMER_RETURN_REFUND_METHODS = REFUND_METHODS;
export default mongoose.model("CustomerReturn", customerReturnSchema);
