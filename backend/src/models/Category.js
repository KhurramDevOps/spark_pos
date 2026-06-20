import mongoose from "mongoose";

const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // <CAT> portion of auto-generated SKUs (spec 001 §9.2). Derived from name
    // on create, editable, stable across name changes. Not required to be
    // unique — two categories may share a prefix (they share its counter).
    skuPrefix: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 4,
    },
    isActive: { type: Boolean, default: true },
    // Room for floor -> section nesting later; unused now.
    // parentId: { type: Schema.Types.ObjectId, ref: "Category" },
  },
  { timestamps: true }
);

// Case-insensitive uniqueness on name (collation strength 2 = case-insensitive).
categorySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

export default mongoose.model("Category", categorySchema);
