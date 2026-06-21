import { z } from "zod";

/** A 24-hex-char Mongo ObjectId, as a string. */
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "invalid id");

/**
 * A non-negative decimal *string* (quantities cross the API as strings to avoid
 * float coercion — spec 001 §6/§7). No sign, so this also enforces ">= 0".
 * Anything that isn't a clean decimal (e.g. "", "abc", "1.2.3", "1e3") fails here.
 */
export const nonNegativeDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal (e.g. \"2.5\")");

/**
 * A strictly-positive decimal *string* (> 0). Same format as above, but rejects
 * zero ("0", "0.0", "0.00") — there must be at least one non-zero digit. Used for
 * purchase line quantities (spec 003 §7).
 */
export const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a positive decimal (e.g. \"2.5\")")
  .refine((v) => /[1-9]/.test(v), "must be greater than 0");
