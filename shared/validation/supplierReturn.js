import { z } from "zod";
import { objectId, positiveDecimalString } from "./common.js";

// One return line: an item and a positive quantity (item base unit). The cost
// basis is captured server-side from the item's current avgCost, never sent.
const returnLineSchema = z.object({
  itemId: objectId,
  qty: positiveDecimalString,
});

// supplierId comes from the route param (/suppliers/:id/returns), not the body.
export const createSupplierReturnSchema = z.object({
  date: z.coerce.date().optional(),
  lines: z.array(returnLineSchema).min(1, "a return needs at least one line"),
  note: z.string().trim().max(2000).optional(),
});
