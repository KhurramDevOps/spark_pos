import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Atomic named counters. Used for SKU numbering: one independent sequence per
 * category SKU prefix (the prefix string IS the _id), NOT a single global
 * counter. `next("WIR")` and `next("FAN")` advance separately.
 */
const counterSchema = new Schema(
  {
    _id: { type: String, required: true }, // the SKU prefix, e.g. "WIR"
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

/**
 * Atomically increment and return the next sequence value for `prefix`.
 * Must be called inside the item-create transaction (pass its session) so
 * concurrent creates can't collide.
 * @param {string} prefix
 * @param {import("mongoose").ClientSession} [session]
 * @returns {Promise<number>}
 */
counterSchema.statics.next = async function (prefix, session) {
  const doc = await this.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { returnDocument: "after", upsert: true, session }
  );
  return doc.seq;
};

export default mongoose.model("Counter", counterSchema);
