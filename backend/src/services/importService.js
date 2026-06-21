/**
 * CSV bulk-import orchestration (spec 002).
 *
 * `analyzeUpload()` is the SINGLE source of truth for parsing + validating an
 * upload (header check, per-row normalize, batched DB lookups, cross-row rules).
 * BOTH preview and commit call it — commit re-validates from scratch via the
 * exact same path, never a looser one (ADR-004). Preview writes nothing and
 * never burns the SKU counter; commit creates categories up front, then loops
 * the valid rows through the existing tested `createItem()` (one txn per row).
 */
import Category from "../models/Category.js";
import Item from "../models/Item.js";
import ImportLog from "../models/ImportLog.js";
import { createItem } from "./itemService.js";
import { createCategory } from "./categoryService.js";
import {
  parseCsv,
  validateHeaders,
  normalizeRow,
  errorReportToCsv,
  MAX_ROWS,
  MAX_BYTES,
} from "../lib/csvImport.js";
import * as stash from "../lib/importStash.js";

/** A domain error carrying an HTTP status for the error handler. */
function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Case-insensitive key for de-duping names/SKUs within the file. */
const ci = (s) => String(s).trim().toLowerCase();

/**
 * Parse + fully validate an upload. No writes. Returns the per-row analysis used
 * identically by preview and commit.
 *
 * @param {string} text - raw CSV text
 * @returns {Promise<{ rows: object[], newCategories: string[], summary: object }>}
 *   each row: { rowNumber, status: "create"|"error", errors, warnings, name,
 *              categoryName, sku (display), data (normalize output|null), raw }
 */
export async function analyzeUpload(text) {
  if (Buffer.byteLength(String(text), "utf8") > MAX_BYTES) {
    throw httpError(
      `file is larger than ${MAX_BYTES / (1024 * 1024)} MB. Split the file and import in parts.`,
      413
    );
  }

  const { fields, rows } = parseCsv(text);

  const headerCheck = validateHeaders(fields);
  if (!headerCheck.ok) {
    throw httpError(`missing required column(s): ${headerCheck.missing.join(", ")}`, 422);
  }

  if (rows.length === 0) throw httpError("the file has no data rows", 422);
  if (rows.length > MAX_ROWS) {
    throw httpError(
      `file has ${rows.length} rows; the limit is ${MAX_ROWS}. Split the file and import in parts.`,
      413
    );
  }

  // 1) Per-row normalize (collects all field errors per row).
  const normalized = rows.map((raw, i) => normalizeRow(raw, i + 2)); // +2: header is line 1
  const validRows = normalized.filter((r) => r.ok);

  // 2) Batched DB lookups — one query each, never per-row.
  const existingCats = validRows.length
    ? await Category.find({ name: { $in: validRows.map((r) => r.data.categoryName) } })
        .collation({ locale: "en", strength: 2 })
        .select("name")
    : [];
  const existingCatSet = new Set(existingCats.map((c) => ci(c.name)));

  const providedSkus = validRows.filter((r) => r.skuProvided).map((r) => r.skuProvided);
  const existingItems = providedSkus.length
    ? await Item.find({ sku: { $in: providedSkus } })
        .collation({ locale: "en", strength: 2 })
        .select("sku isActive")
    : [];
  const existingSkuMap = new Map(existingItems.map((it) => [ci(it.sku), it.isActive]));

  // 3) Second pass: cross-row + DB rules; build the analysis rows.
  const newCategoryDisplay = new Map(); // ci -> display name (first seen)
  const seenSkus = new Set();
  const seenItems = new Map(); // ci(name)+ci(category) -> first rowNumber

  let toCreate = 0;
  let errorCount = 0;

  const analyzedRows = normalized.map((r, i) => {
    const errors = [...r.errors];
    const warnings = [];

    if (r.ok) {
      const catKey = ci(r.data.categoryName);

      if (r.skuProvided) {
        const skuKey = ci(r.skuProvided);
        if (existingSkuMap.has(skuKey)) {
          const inactive = existingSkuMap.get(skuKey) === false;
          errors.push(
            `SKU "${r.skuProvided}" already exists${inactive ? " (on an inactive item)" : ""} — rows never update existing items`
          );
        } else if (seenSkus.has(skuKey)) {
          errors.push(`SKU "${r.skuProvided}" is duplicated earlier in this file`);
        } else {
          seenSkus.add(skuKey);
        }
      }

      const itemKey = `${ci(r.data.name)} ${catKey}`;
      if (seenItems.has(itemKey)) {
        warnings.push(`same name + category as row ${seenItems.get(itemKey)} in this file`);
      } else {
        seenItems.set(itemKey, r.rowNumber);
      }

      if (!existingCatSet.has(catKey) && !newCategoryDisplay.has(catKey)) {
        newCategoryDisplay.set(catKey, r.data.categoryName);
      }
    }

    const ok = errors.length === 0;
    if (ok) toCreate += 1;
    else errorCount += 1;

    return {
      rowNumber: r.rowNumber,
      status: ok ? "create" : "error",
      errors,
      warnings,
      name: r.display.name,
      categoryName: r.display.categoryName,
      sku: r.display.sku,
      data: ok ? r.data : null,
      raw: rows[i],
    };
  });

  return {
    rows: analyzedRows,
    newCategories: [...newCategoryDisplay.values()],
    summary: {
      total: normalized.length,
      toCreate,
      errors: errorCount,
      newCategories: newCategoryDisplay.size,
    },
  };
}

/** Shape a skipped row for the downloadable error report / ImportLog. */
function reportRow(row, message) {
  return { ...row.raw, rowNumber: row.rowNumber, _error: message };
}

/**
 * Dry-run preview: analyze + stash the upload under a token (for commit), return
 * a lean preview payload. Writes nothing; never burns the SKU counter.
 */
export async function previewImport({ text, filename, createdBy }) {
  const analysis = await analyzeUpload(text);
  const token = stash.put({ text, filename, createdBy });

  return {
    token,
    ttlSeconds: stash.TTL_SECONDS,
    summary: analysis.summary,
    newCategories: analysis.newCategories,
    rows: analysis.rows.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      name: r.name,
      categoryName: r.categoryName,
      sku: r.sku,
      errors: r.errors,
      warnings: r.warnings,
    })),
  };
}

/**
 * Commit a previously-previewed upload (by token). Re-reads the stashed file and
 * re-validates from scratch via analyzeUpload (same path as preview). Creates new
 * categories up front (deduped, case-insensitive), then loops valid rows through
 * createItem (one transaction per row). Skipped rows are reported; an ImportLog
 * is written. Returns counts + the error report.
 *
 * @param {{ token: string, createdBy: any }} input
 */
export async function commitImport({ token, createdBy }) {
  if (!createdBy) throw new Error("createdBy is required (audit)");

  const entry = stash.get(token);
  if (!entry) {
    throw httpError("this import preview has expired or was not found — please re-upload the file", 410);
  }

  const analysis = await analyzeUpload(entry.text);
  const createRows = analysis.rows.filter((r) => r.status === "create");

  // --- Categories: resolve/create ALL up front, before any row transaction. ---
  // Dedup the referenced names case-insensitively; reuse existing, create the rest.
  const wantedByCi = new Map(); // ci -> display name
  for (const r of createRows) wantedByCi.set(ci(r.data.categoryName), r.data.categoryName);

  const existing = wantedByCi.size
    ? await Category.find({ name: { $in: [...wantedByCi.values()] } })
        .collation({ locale: "en", strength: 2 })
        .select("name")
    : [];
  const categoryIdByCi = new Map(existing.map((c) => [ci(c.name), c._id]));

  let newCategoriesCreated = 0;
  for (const [key, displayName] of wantedByCi) {
    if (!categoryIdByCi.has(key)) {
      const cat = await createCategory({ name: displayName });
      categoryIdByCi.set(key, cat._id);
      newCategoriesCreated += 1;
    }
  }

  // --- Rows: in file order. Validation errors and create failures both report. ---
  let created = 0;
  let skipped = 0;
  const errorReport = [];

  for (const row of analysis.rows) {
    if (row.status === "error") {
      skipped += 1;
      errorReport.push(reportRow(row, row.errors.join("; ")));
      continue;
    }
    try {
      const categoryId = categoryIdByCi.get(ci(row.data.categoryName));
      await createItem({ ...row.data, categoryId }, { userId: createdBy });
      created += 1;
    } catch (err) {
      // One row failing rolls back only its own transaction (createItem); the
      // rows that already landed stay committed (partial import, spec 002 §6).
      skipped += 1;
      errorReport.push(reportRow(row, err.message));
    }
  }

  const counts = { created, skipped, newCategories: newCategoriesCreated };
  const log = await ImportLog.create({ filename: entry.filename, createdBy, counts, errorReport });

  stash.remove(token);

  return {
    importLogId: log._id,
    counts,
    errorReport,
    // CSV form for direct download (original columns + rowNumber + _error).
    errorReportCsv: errorReport.length ? errorReportToCsv(errorReport) : null,
  };
}
