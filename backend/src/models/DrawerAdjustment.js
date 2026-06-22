import mongoose from "mongoose";

const { Schema } = mongoose;

const DIRECTIONS = ["in", "out"];

/**
 * Cash moving between the drawer and home (spec 005). "in" = home→drawer (e.g. to
 * cover a supplier payment); "out" = drawer→home (taken home for the night).
 * Flat, single-collection insert, no transaction. Daily-close buckets by
 * `createdAt` in Asia/Karachi (ADR-010).
 */
const drawerAdjustmentSchema = new Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    direction: { type: String, required: true, enum: DIRECTIONS },
    amount: { type: Schema.Types.Decimal128, required: true }, // whole paisa, > 0
    note: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

drawerAdjustmentSchema.index({ createdAt: 1 });

export const DRAWER_DIRECTIONS = DIRECTIONS;
export default mongoose.model("DrawerAdjustment", drawerAdjustmentSchema);
