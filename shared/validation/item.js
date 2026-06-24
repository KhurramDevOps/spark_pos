import { z } from "zod";
import { objectId, nonNegativeDecimalString, httpUrl } from "./common.js";

// A URL-kind image set/replaced via JSON (create or PATCH). Upload-kind images
// are produced server-side by the upload route, never accepted from the client.
const urlImage = z.object({ kind: z.literal("url"), ref: httpUrl });

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
  // Declared opening cost (paisa, decimal string >= 0). Paired with openingQty
  // (spec 006c): both together or both absent — never one without the other.
  openingUnitCost: nonNegativeDecimalString.optional(),
  // Optional URL image at create time (uploads come later via the image route).
  image: urlImage.optional(),
}).superRefine((v, ctx) => {
  const hasQty = v.openingQty != null && v.openingQty !== "0" && /[1-9]/.test(v.openingQty);
  const hasCost = v.openingUnitCost != null && v.openingUnitCost !== "";
  if (hasQty && !hasCost) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "openingUnitCost is required when openingQty is set", path: ["openingUnitCost"] });
  }
  if (hasCost && !hasQty) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "openingQty must be greater than 0 when openingUnitCost is set", path: ["openingQty"] });
  }
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
    // Set or replace the image with a URL. Removal is via DELETE /items/:id/image.
    image: urlImage,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "no fields to update" });

export const adjustStockSchema = z.object({
  countedQty: nonNegativeDecimalString,
  note: z.string().trim().min(1, "a reason note is required for stock adjustment"),
});

// Owner-only "repair opening cost" (spec 006c §4 path #4). unitCost is paisa
// (>= 0). qty is optional — the service defaults it to the item's current
// stockQty; when supplied it must be a positive decimal (the service rejects 0).
// note is mandatory — the owner must explain the repair.
export const repairOpeningCostSchema = z.object({
  unitCost: nonNegativeDecimalString,
  qty: nonNegativeDecimalString.optional(),
  note: z.string().trim().min(1, "a note is required to repair opening cost"),
});
