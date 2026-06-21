import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Audit record for a bulk CSV import (spec 002 §5). One document is written per
 * *commit* (previews write nothing). This is the only audit trail for an import,
 * since there is no per-item undo — keep it self-contained.
 */
const importLogSchema = new Schema(
  {
    // Filename as uploaded, informational only.
    filename: { type: String, trim: true },

    // The importer (audit). Required, same as StockMovement.createdBy.
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    counts: {
      created: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      newCategories: { type: Number, default: 0 },
    },

    // The failed rows + reasons (same shape as the downloadable error report:
    // original columns + rowNumber + error). Empty when nothing failed. Stored
    // so the audit record stands alone without the original file.
    errorReport: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("ImportLog", importLogSchema);
