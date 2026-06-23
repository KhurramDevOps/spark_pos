import { getDayClose, saveDayClose, getLineDetail } from "../services/dailyCloseService.js";
import { rupeesToPaisa } from "../../../shared/validation/money.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const get = wrap(async (req, res) => {
  // ?date=YYYY-MM-DD (Asia/Karachi); defaults to today.
  res.json(await getDayClose(req.query.date || undefined));
});

export const save = wrap(async (req, res) => {
  const v = req.validated;
  const doc = await saveDayClose(
    v.date,
    { actualCash: String(rupeesToPaisa(v.actualCash, "actualCash").value), note: v.note },
    { userId: req.userId }
  );
  res.json(doc);
});

export const lineDetail = wrap(async (req, res) => {
  // Drill-down for one cash-math line: ?date=YYYY-MM-DD&line=cashSales
  res.json(await getLineDetail(req.query.date || undefined, req.query.line));
});
