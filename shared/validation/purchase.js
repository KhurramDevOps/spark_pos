import { z } from "zod";
import { objectId, positiveDecimalString } from "./common.js";
import { rupeesString } from "./money.js";

// One purchase line: an item, a positive quantity (item base unit), and the unit
// cost paid in rupees (≤2dp). qty is a quantity (decimal string); unitCost is money.
const purchaseLineSchema = z.object({
  itemId: objectId,
  qty: positiveDecimalString,
  unitCost: rupeesString("unitCost"),
});

export const createPurchaseSchema = z
  .object({
    date: z.coerce.date().optional(), // label only — posting order governs cost history
    supplierId: objectId.optional(),
    paymentType: z.enum(["cash", "credit"]),
    lines: z.array(purchaseLineSchema).min(1, "a purchase needs at least one line"),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.paymentType !== "credit" || !!d.supplierId, {
    message: "a credit purchase requires a supplier (you can't owe nobody)",
    path: ["supplierId"],
  });
