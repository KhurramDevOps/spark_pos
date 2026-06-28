import { z } from "zod";
import { rupeesString } from "./money.js";

// Mirrors supplier.js — a customer is the sales-side counterpart of a supplier.

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  // Opening balance owed to the shop at creation; rupees, >= 0.
  openingBalance: rupeesString("openingBalance").default("0"),
  // Optional "promised to pay by" date for the khata (slice 4).
  promisedPayBy: z.coerce.date().optional(),
});

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40).nullable(),
    // Nullable so the promise can be cleared.
    promisedPayBy: z.coerce.date().nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" });

export const customerPaymentSchema = z
  .object({
    amount: rupeesString("amount"),
    date: z.coerce.date().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((d) => /[1-9]/.test(d.amount), {
    message: "amount must be greater than 0",
    path: ["amount"],
  });
