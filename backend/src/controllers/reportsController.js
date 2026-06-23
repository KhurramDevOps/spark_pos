import { getReport } from "../services/reportsService.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const get = wrap(async (req, res) => {
  // ?window=today|this_week|this_month|last_month|custom (+ start/end for custom).
  const v = req.validated;
  res.json(await getReport({ window: v.window, start: v.start, end: v.end }));
});
