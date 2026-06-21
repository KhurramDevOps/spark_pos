import { z } from "zod";
import { rupeesString } from "./money.js";

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  // Opening balance owed at creation; rupees, >= 0.
  openingBalance: rupeesString("openingBalance").default("0"),
});

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40).nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" });

export const supplierPaymentSchema = z
  .object({
    amount: rupeesString("amount"),
    date: z.coerce.date().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((d) => /[1-9]/.test(d.amount), {
    message: "amount must be greater than 0",
    path: ["amount"],
  });
