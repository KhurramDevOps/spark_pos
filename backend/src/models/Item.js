import mongoose from "mongoose";
import { uploadImageUrl } from "../lib/imageUrl.js";

const { Schema } = mongoose;

const BASE_UNITS = ["gaz", "meter", "kg", "piece", "dozen", "coil", "set"];

const isInteger = {
  validator: Number.isInteger,
  message: "{PATH} must be an integer",
};

// Locked contract for future multi-unit selling (spec 001 §10). factorToBase is
// Decimal128 because a sell-unit can be fractional in base units (e.g. a coil =
// 90.5 gaz). No UI builds these yet — defining the shape so it can't be reshaped.
const itemUnitSchema = new Schema(
  {
    unitName: { type: String, required: true, trim: true },
    factorToBase: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: false }
);

// One optional image per item (spec 006b). `ref` is a storage key (uploads,
// served at /api/static/items/<ref>) or an external URL. `updatedAt` busts the
// browser cache on replace. Bytes live outside Mongo behind the storage driver
// (ADR-012) — this sub-doc holds only the reference.
const itemImageSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["upload", "url"] },
    ref: { type: String, required: true, trim: true },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

// On serialization, resolve the driver-correct public URL for upload-kind images
// (ADR-012). The frontend reads image.url and never knows which driver produced
// it. url-kind images carry no `url` field — their ref is already an external URL.
itemImageSchema.set("toJSON", {
  transform(_doc, ret) {
    const url = uploadImageUrl(ret);
    if (url) ret.url = url;
    return ret;
  },
});

// One warranty term (spec 009). An item may carry several with different durations
// (motor: 10 years, fan kit: 1 year). `label` is the component name (optional). These
// are SNAPSHOTTED onto each item-kind Sale line at sale time so a past sale's warranty
// is frozen even if the item's terms are later edited (the costAtTime pattern, ADR-007).
const warrantyTermSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 60, default: "" },
    durationValue: { type: Number, required: true, min: 1, validate: isInteger },
    durationUnit: { type: String, required: true, enum: ["years", "months", "days"] },
  },
  { _id: false }
);

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

    // Warranty terms (spec 009). Default []; mutable metadata — editing affects only
    // FUTURE sales (past sales hold their own snapshot).
    warranties: { type: [warrantyTermSchema], default: [] },

    isActive: { type: Boolean, default: true },

    // Optional product image (spec 006b). Absent = no image (render placeholder).
    image: { type: itemImageSchema, default: null },

    // Future ItemUnit sub-docs (multi-unit selling). Shape locked; unused now.
    units: { type: [itemUnitSchema], default: [] },
  },
  { timestamps: true }
);

// Case-insensitive uniqueness on SKU (global, across active + inactive).
itemSchema.index(
  { sku: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

export const ITEM_BASE_UNITS = BASE_UNITS;
export { warrantyTermSchema };
export default mongoose.model("Item", itemSchema);
