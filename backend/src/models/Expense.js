import mongoose from "mongoose";

const { Schema } = mongoose;

const EXPENSE_CATEGORIES = ["salary", "electricity", "other"];

/**
 * A shop expense (spec 005). Flat — no ledger, no running balance, no recipient.
 * Daily-close buckets by `createdAt` in Asia/Karachi (ADR-010); `date` is a
 * user-editable label. Single-collection insert, no transaction (ADR-009).
 */
const expenseSchema = new Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    category: { type: String, required: true, enum: EXPENSE_CATEGORIES },
    amount: { type: Schema.Types.Decimal128, required: true }, // whole paisa, > 0
    note: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Fast daily-range queries bucket by createdAt (ADR-010), not the date label.
expenseSchema.index({ createdAt: 1 });

export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES;
export default mongoose.model("Expense", expenseSchema);
