import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Single store-level settings document (singleton, fixed _id "global").
 * For now it holds only `allowNegativeInventory`. The flag is created here and
 * readable now; it is consumed by the sales feature later, not in spec 001.
 */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: "global" },
    allowNegativeInventory: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/**
 * Get the singleton, creating it with defaults on first access.
 * @param {import("mongoose").ClientSession} [session]
 */
settingsSchema.statics.getSingleton = async function (session) {
  return this.findOneAndUpdate(
    { _id: "global" },
    { $setOnInsert: { _id: "global" } },
    { returnDocument: "after", upsert: true, session }
  );
};

export default mongoose.model("Settings", settingsSchema);
