import mongoose from "mongoose";

const { Schema } = mongoose;

// "reversal" is distinct from "return" so a purchase-reversal (undo a whole
// posted purchase) is readable in history separately from a supplier-return
// (send some stock back). Both use negative qty. See ADR-006.
// "opening" declares pre-existing inventory with its real per-unit cost — a
// cost-bearing event like "purchase", but with no supplier/cash side (ADR-013).
const MOVEMENT_TYPES = ["purchase", "opening", "sale", "return", "adjustment", "reversal"];

const stockMovementSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },

    // Signed quantity (+in / -out). Decimal128. Must be non-zero — a movement
    // that changes nothing is never written.
    qty: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v) => v != null && v.toString() !== "0",
        message: "qty must be non-zero",
      },
    },

    type: { type: String, required: true, enum: MOVEMENT_TYPES },

    // Polymorphic pointer (purchase/sale/etc.). Intentionally NOT a Mongoose
    // ref, so it is not auto-populated. Optional; null for adjustments.
    refId: { type: Schema.Types.ObjectId },

    // On a reversing row, points at the Purchase being reversed so the cost
    // replay can drop the original purchase's rows AND their reversing pair
    // together ("exclude, don't subtract" — ADR-006 / spec 003b §6).
    reversalRef: { type: Schema.Types.ObjectId },

    // Unit cost captured at movement time (used by purchases/COGS later).
    costAtTime: { type: Schema.Types.Decimal128 },

    note: { type: String, trim: true },

    // Audit: who recorded the movement.
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// The exact key the avgCost replay reads by: an item's movements in posting
// order (createdAt, then _id as tiebreak for same-millisecond bulk inserts).
stockMovementSchema.index({ itemId: 1, createdAt: 1, _id: 1 });

// A note is mandatory for manual adjustments (the reason for the correction).
stockMovementSchema.pre("validate", function () {
  if (this.type === "adjustment" && !this.note) {
    throw new Error("note is required for adjustment movements");
  }
});

export const STOCK_MOVEMENT_TYPES = MOVEMENT_TYPES;
export default mongoose.model("StockMovement", stockMovementSchema);
