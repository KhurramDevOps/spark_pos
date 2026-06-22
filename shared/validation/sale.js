import { z } from "zod";
import { objectId, positiveDecimalString } from "./common.js";
import { rupeesString } from "./money.js";

// One sale line: an item, a positive quantity (item base unit), and the unit price
// charged in rupees (≤2dp, 0 allowed for giveaways). qty is a quantity string;
// unitPrice is money. suggestedPrice + costAtTime are snapshotted server-side, not
// sent by the client.
const saleLineSchema = z.object({
  itemId: objectId,
  qty: positiveDecimalString,
  unitPrice: rupeesString("unitPrice"),
});

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
