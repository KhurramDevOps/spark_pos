import mongoose from "mongoose";

const { Schema } = mongoose;

const MOVEMENT_TYPES = ["purchase", "sale", "return", "adjustment"];

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

    // Unit cost captured at movement time (used by purchases/COGS later).
    costAtTime: { type: Schema.Types.Decimal128 },

    note: { type: String, trim: true },

    // Audit: who recorded the movement.
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// A note is mandatory for manual adjustments (the reason for the correction).
stockMovementSchema.pre("validate", function () {
  if (this.type === "adjustment" && !this.note) {
    throw new Error("note is required for adjustment movements");
  }
});

export const STOCK_MOVEMENT_TYPES = MOVEMENT_TYPES;
export default mongoose.model("StockMovement", stockMovementSchema);
