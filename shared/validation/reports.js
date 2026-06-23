import { z } from "zod";

// Reports query (spec 006 §7). Read-only endpoint — the only validation surface.
// `window` is required; `custom` additionally requires real, non-future start/end
// with start <= end. Presets need nothing else. Dates are Karachi calendar labels
// (YYYY-MM-DD); the backend resolver turns them into Asia/Karachi instants (ADR-010).

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const todayYMD = () => new Date().toISOString().slice(0, 10);

export const REPORT_WINDOW_VALUES = ["today", "this_week", "this_month", "last_month", "custom"];

export const reportQuerySchema = z
  .object({
    window: z.enum(REPORT_WINDOW_VALUES),
    start: ymd.optional(),
    end: ymd.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.window !== "custom") return;
    if (!v.start || !v.end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "custom window requires start and end", path: ["start"] });
      return;
    }
    if (v.start > v.end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "start must be on or before end", path: ["start"] });
    }
    const today = todayYMD();
    if (v.start > today || v.end > today) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dates cannot be in the future", path: ["end"] });
    }
  });
