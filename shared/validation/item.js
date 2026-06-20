import { z } from "zod";
import { objectId, nonNegativeDecimalString } from "./common.js";

// The allowed base units (spec 001 §9.1). Kept here so frontend and backend
// share one source of truth.
export const BASE_UNITS = ["gaz", "meter", "kg", "piece", "dozen", "coil", "set"];

// SKU: letters, digits, hyphens only; no spaces. Uniqueness is enforced in the DB.
const skuField = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9-]+$/, "SKU may contain only letters, numbers, and hyphens");

// Prices are integer paisa (rupee<->paisa conversion happens at the UI boundary).
const retailPrice = z.number().int().min(1, "retail price (paisa) must be greater than 0");
const wholesalePrice = z.number().int().min(0, "wholesale price (paisa) cannot be negative");
const reorderLevel = z.number().int().min(0, "reorder level cannot be negative");

export const createItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  categoryId: objectId,
  baseUnit: z.enum(BASE_UNITS),
  retailPrice,
  wholesalePrice: wholesalePrice.optional(),
  reorderLevel: reorderLevel.default(0),
  notes: z.string().trim().max(2000).optional(),
  // Optional manual override; auto-generated when omitted.
  sku: skuField.optional(),
  // Opening stock; defaults to "0" (then no opening movement is written).
  openingQty: nonNegativeDecimalString.default("0"),
});

// All fields optional on update. stockQty, avgCost, and isActive are intentionally
// NOT updatable here (stock changes only via adjustment; active via deactivate/reactivate).
export const updateItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    categoryId: objectId,
    baseUnit: z.enum(BASE_UNITS),
    retailPrice,
    wholesalePrice: wholesalePrice.nullable(),
    reorderLevel,
    notes: z.string().trim().max(2000).nullable(),
    sku: skuField,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "no fields to update" });

export const adjustStockSchema = z.object({
  countedQty: nonNegativeDecimalString,
  note: z.string().trim().min(1, "a reason note is required for stock adjustment"),
});
