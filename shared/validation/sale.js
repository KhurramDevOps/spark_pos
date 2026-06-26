import { z } from "zod";
import { objectId, positiveDecimalString } from "./common.js";
import { rupeesString } from "./money.js";

// A sale line is one of two kinds (spec 008 / ADR-016), discriminated on `kind`:
//   - "item"  (default when `kind` is absent — backward compatible with spec 004
//     payloads): a catalogued item by id. costAtTime/suggestedPrice are snapshotted
//     server-side, never sent by the client.
//   - "quick": an uncatalogued good typed at checkout — a free-text `name` + price,
//     NO itemId and NO cost basis.
// Both carry a positive qty (base unit) and a unitPrice in rupees (≤2dp, 0 allowed
// for giveaways). The union routes by `kind`; a missing `kind` defaults to "item".
const itemLineSchema = z.object({
  kind: z.literal("item"),
  itemId: objectId,
  qty: positiveDecimalString,
  unitPrice: rupeesString("unitPrice"),
});

const quickLineSchema = z.object({
  kind: z.literal("quick"),
  name: z.string().trim().min(1, "name is required").max(120, "name is at most 120 characters"),
  qty: positiveDecimalString,
  unitPrice: rupeesString("unitPrice"),
});

const saleLineSchema = z.preprocess(
  // Default a missing/blank `kind` to "item" so existing clients keep working.
  (v) => (v && typeof v === "object" && v.kind == null ? { ...v, kind: "item" } : v),
  z.discriminatedUnion("kind", [itemLineSchema, quickLineSchema])
);

export const createSaleSchema = z
  .object({
    date: z.coerce.date().optional(),
    customerId: objectId.optional(),
    paymentType: z.enum(["cash", "credit"]),
    priceMode: z.enum(["retail", "wholesale"]),
    lines: z.array(saleLineSchema).min(1, "a sale needs at least one line"),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.paymentType !== "credit" || !!d.customerId, {
    message: "a credit sale requires a customer (you can't owe from nobody)",
    path: ["customerId"],
  });
