import Counter from "../models/Counter.js";

/**
 * Generate the next SKU for a category prefix: `<PREFIX>-<NNNN>`, e.g. WIR-0007.
 * Uses the per-prefix atomic counter. Must run inside the create transaction
 * (pass the session) so concurrent creates can't produce duplicate numbers.
 * @param {string} prefix - uppercased category skuPrefix
 * @param {import("mongoose").ClientSession} [session]
 */
export async function generateSku(prefix, session) {
  const seq = await Counter.next(prefix, session);
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}
