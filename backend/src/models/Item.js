import mongoose from "mongoose";

const { Schema } = mongoose;

const BASE_UNITS = ["gaz", "meter", "kg", "piece", "dozen", "coil", "set"];

const isInteger = {
  validator: Number.isInteger,
  message: "{PATH} must be an integer",
};

const itemSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    // Immutable once a StockMovement exists — enforced in the service layer.
    baseUnit: { type: String, required: true, enum: BASE_UNITS },

    // Prices: integer paisa. retailPrice must be > 0; wholesalePrice optional.
    retailPrice: { type: Number, required: true, min: 1, validate: isInteger },
    wholesalePrice: { type: Number, min: 0, validate: isInteger },

    // Weighted-average cost, set by purchases later. Decimal128 (fractional
    // paisa) so COGS doesn't drift. Read-only in this spec; default 0.
    avgCost: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString("0"),
    },

    reorderLevel: { type: Number, default: 0, min: 0, validate: isInteger },

    // Cached stock. Decimal128, and intentionally has NO min — may go negative
    // (driven there only by future sales). The *input* paths validate >= 0.
    stockQty: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString("0"),
    },

    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },

    // Future ItemUnit sub-docs (multi-unit selling). Present but unused now.
    units: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

// Case-insensitive uniqueness on SKU (global, across active + inactive).
itemSchema.index(
  { sku: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

export const ITEM_BASE_UNITS = BASE_UNITS;
export default mongoose.model("Item", itemSchema);
