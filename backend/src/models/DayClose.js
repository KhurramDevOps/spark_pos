import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * One closed shop-day (spec 005). `date` is the Asia/Karachi day START as a UTC
 * instant (unique — one close per Karachi day, ADR-010). `actualCash` is what the
 * owner physically counted that night and is what carries forward as the next
 * day's starting cash — it is NEVER recomputed, even if a retroactive void makes
 * the expected snapshot stale (ADR-009). The two *Snapshot fields are a
 * point-in-time audit of what the owner saw at close.
 */
const dayCloseSchema = new Schema(
  {
    date: { type: Date, required: true, unique: true }, // Karachi day start (UTC instant)
    actualCash: { type: Schema.Types.Decimal128, required: true }, // whole paisa, >= 0
    expectedCashSnapshot: { type: Schema.Types.Decimal128, required: true }, // computed at close
    differenceSnapshot: { type: Schema.Types.Decimal128, required: true }, // actual − expected, signed
    note: { type: String, trim: true, maxlength: 2000 },
    closedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("DayClose", dayCloseSchema);
