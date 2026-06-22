import { z } from "zod";
import { rupeesString } from "./money.js";

const notFuture = (d) => d.getTime() <= Date.now();

// Expense: category enum + amount (rupees → paisa at the boundary). Mirrors the
// flat payment shape, minus any ledger. No future-dated expenses (§7 / §9.4).
export const createExpenseSchema = z.object({
  date: z.coerce.date().refine(notFuture, "date cannot be in the future").optional(),
  category: z.enum(["salary", "electricity", "other"]),
  amount: rupeesString("amount").refine((v) => /[1-9]/.test(v), "amount must be greater than 0"),
  note: z.string().trim().max(2000).optional(),
});

export const updateExpenseSchema = createExpenseSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" });

// DrawerAdjustment: cash in/out between drawer and home.
export const createDrawerAdjustmentSchema = z.object({
  date: z.coerce.date().refine(notFuture, "date cannot be in the future").optional(),
  direction: z.enum(["in", "out"]),
  amount: rupeesString("amount").refine((v) => /[1-9]/.test(v), "amount must be greater than 0"),
  note: z.string().trim().max(2000).optional(),
});

// Save a day's close: actualCash counted (>= 0; 0 allowed on a closed-shop day).
export const saveDayCloseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  actualCash: rupeesString("actualCash"), // >= 0 by the money rule
  note: z.string().trim().max(2000).optional(),
});
