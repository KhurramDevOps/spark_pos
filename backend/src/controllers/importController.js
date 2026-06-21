import { TEMPLATE_CSV } from "../lib/csvImport.js";
import { previewImport, commitImport } from "../services/importService.js";

/** Wrap an async handler so thrown/rejected errors reach the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** GET /api/imports/template — download the locked-header template CSV. */
export const template = (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="sparkpos-items-template.csv"');
  res.send(TEMPLATE_CSV);
};

/**
 * POST /api/imports/preview — body is the raw CSV text (text/csv). Returns a
 * dry-run preview + an import token. Writes nothing; does not burn the SKU counter.
 */
export const preview = wrap(async (req, res) => {
  const text = typeof req.body === "string" ? req.body : "";
  if (!text.trim()) {
    res.status(422);
    throw new Error("no CSV content was uploaded");
  }
  const filename = req.get("x-filename") || undefined;
  const result = await previewImport({ text, filename, createdBy: req.userId });
  res.json(result);
});

/**
 * POST /api/imports/commit — body { token }. Re-validates the stashed upload and
 * imports the valid rows. Returns counts + the error report.
 */
export const commit = wrap(async (req, res) => {
  const token = req.body?.token;
  if (!token) {
    res.status(400);
    throw new Error("token is required");
  }
  const result = await commitImport({ token, createdBy: req.userId });
  res.json(result);
});
