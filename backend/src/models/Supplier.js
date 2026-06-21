import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A supplier the owner buys from (spec 003). Optional on any purchase — only
 * needed for credit buys or repeat suppliers.
 */
const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    phone: { type: String, trim: true },

    // Starting balance owed at creation; immutable starting point.
    openingBalance: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString("0"),
    },

    // Cached running balance owed (paisa). Set = openingBalance on create, then
    // moved in-transaction by credit purchases (+) and payments (−). Intentionally
    // NO min — may go negative (advance/overpayment), surfaced not blocked (spec 003 §6).
    balance: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString("0"),
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Supplier", supplierSchema);
