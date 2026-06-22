import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A customer the shop sells to (spec 004). Optional on a cash sale — only needed
 * for credit (udhaar) sales or repeat customers with a khata. Mirrors Supplier.
 */
const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    phone: { type: String, trim: true },

    // Starting balance owed to the shop at creation; immutable starting point.
    openingBalance: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString("0"),
    },

    // Cached running balance owed TO the shop (paisa). Set = openingBalance on
    // create, then moved in-transaction by credit sales (+) and payments (−).
    // Intentionally NO min — may go negative (a customer advance; the shop owes
    // them), surfaced not blocked (spec 004 §6).
    balance: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString("0"),
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Customer", customerSchema);
