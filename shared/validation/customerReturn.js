import { z } from "zod";
import { objectId, positiveDecimalString } from "./common.js";

// One return line: an item + a positive quantity. valueAtTime/costAtTime are
// snapshotted server-side from the linked sale, never sent by the client.
const returnLineSchema = z.object({
  itemId: objectId,
  qty: positiveDecimalString,
});

// Returns ALWAYS link to a sale (§9.1). `customerId` is only needed for
// khata-credit (enforced in the service once the sale is loaded).
export const createCustomerReturnSchema = z.object({
  saleId: objectId,
  customerId: objectId.optional(),
  date: z.coerce.date().optional(),
  lines: z.array(returnLineSchema).min(1, "a return needs at least one line"),
  refundMethod: z.enum(["cash", "khata-credit"]),
  note: z.string().trim().max(2000).optional(),
});
