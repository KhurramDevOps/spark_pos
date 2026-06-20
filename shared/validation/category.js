import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Optional 3–4 char prefix for SKUs; auto-derived from the name when omitted.
  skuPrefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{3,4}$/, "prefix must be 3–4 letters or digits")
    .optional(),
});
