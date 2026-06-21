/**
 * CSV bulk-import parsing & per-row normalization (spec 002).
 *
 * Pure functions — NO database access here. Parses the uploaded CSV text,
 * validates the header contract, and normalizes a raw row into the shape
 * `createItem()` expects (rupees→paisa, decimals as strings, blank-vs-garbage).
 * The preview/commit orchestration (DB lookups, category creation, transactions)
 * lives in services/importService.js.
 */
import Papa from "papaparse";
import { BASE_UNITS } from "../../../shared/validation/item.js";
import { rupeesToPaisa } from "../../../shared/validation/money.js";

// Locked template headers (spec 002 §7.1 / ADR-004). Order matters for the template.
export const HEADERS = [
  "name",
  "categoryName",
  "baseUnit",
  "retailPrice",
  "wholesalePrice",
  "reorderLevel",
  "openingStock",
  "sku",
];

// Whole-file reject if any of these is missing.
export const REQUIRED_HEADERS = ["name", "categoryName", "baseUnit", "retailPrice"];

// Caps (spec 002 §6 / ADR-004). The route's body-parser limit is set higher than
// MAX_BYTES so the service rejects over-cap files with a friendly message.
export const MAX_ROWS = 10000;
export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Downloadable template: locked headers + two example rows (rupee prices, one
// auto-SKU row with sku left blank, one with an explicit SKU).
export const TEMPLATE_CSV = `${HEADERS.join(",")}
GM 7/29 wire,Wire,gaz,120,110,5,100,
Ceiling Fan,Fans,piece,8500,8000,2,10,FAN-1001
`;

/**
 * Serialize the error report (skipped rows + reasons) to CSV: the original
 * columns + `rowNumber` + `_error`, so the owner can fix and re-upload it
 * directly (the extra columns are ignored on re-import).
 * @param {object[]} reportRows
 */
export function errorReportToCsv(reportRows) {
  const columns = [...HEADERS, "rowNumber", "_error"];
  return Papa.unparse(reportRows, { columns });
}

const SKU_RE = /^[A-Za-z0-9-]+$/;
const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Strip a leading UTF-8 BOM (Excel "Save as CSV" prepends one). */
function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Canonicalize a header cell to its locked name, or return it untouched (ignored later). */
function canonicalizeHeader(h) {
  const cleaned = stripBom(String(h)).trim().toLowerCase();
  return HEADERS.find((canon) => canon.toLowerCase() === cleaned) ?? cleaned;
}

/**
 * Parse CSV text into recognized header fields + row objects.
 * @returns {{ fields: string[], rows: object[] }} fields = recognized headers present;
 *   rows keyed by canonical header name. Empty lines are dropped.
 */
export function parseCsv(text) {
  const result = Papa.parse(stripBom(String(text)), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: canonicalizeHeader,
  });

  const presentHeaders = result.meta?.fields ?? [];
  const fields = HEADERS.filter((h) => presentHeaders.includes(h));
  return { fields, rows: result.data };
}

/**
 * Whole-file header check.
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function validateHeaders(fields) {
  const missing = REQUIRED_HEADERS.filter((h) => !fields.includes(h));
  return { ok: missing.length === 0, missing };
}

/** A blank cell = absent (use the default). Distinguishes "" from a real value. */
function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

/**
 * Normalize one raw CSV row into createItem input, collecting ALL field errors
 * (don't stop at the first) so the owner can fix everything in one pass.
 *
 * @param {object} raw - row object keyed by canonical header
 * @param {number} rowNumber - 1-based file line (header = 1, first data row = 2)
 * @returns {{ rowNumber: number, ok: boolean, errors: string[], data: object|null,
 *             skuProvided: string|null }}
 */
export function normalizeRow(raw, rowNumber) {
  const errors = [];
  const data = {};

  // name — required.
  const name = isBlank(raw.name) ? "" : String(raw.name).trim();
  if (!name) errors.push("name is required");
  else if (name.length > 120) errors.push("name must be 120 characters or fewer");
  else data.name = name;

  // categoryName — required (resolved/created later by the service).
  const categoryName = isBlank(raw.categoryName) ? "" : String(raw.categoryName).trim();
  if (!categoryName) errors.push("categoryName is required");
  else data.categoryName = categoryName;

  // baseUnit — required, enum (case-insensitive input).
  const baseUnit = isBlank(raw.baseUnit) ? "" : String(raw.baseUnit).trim().toLowerCase();
  if (!baseUnit) errors.push("baseUnit is required");
  else if (!BASE_UNITS.includes(baseUnit))
    errors.push(`baseUnit "${raw.baseUnit}" is not valid (one of: ${BASE_UNITS.join(", ")})`);
  else data.baseUnit = baseUnit;

  // retailPrice — required, rupees > 0.
  if (isBlank(raw.retailPrice)) {
    errors.push("retailPrice is required");
  } else {
    const r = rupeesToPaisa(raw.retailPrice, "retailPrice");
    if (r.error) errors.push(r.error);
    else if (r.value <= 0) errors.push("retailPrice must be greater than 0");
    else data.retailPrice = r.value;
  }

  // wholesalePrice — optional, rupees >= 0.
  if (!isBlank(raw.wholesalePrice)) {
    const w = rupeesToPaisa(raw.wholesalePrice, "wholesalePrice");
    if (w.error) errors.push(w.error);
    else data.wholesalePrice = w.value;
  }

  // reorderLevel — optional integer >= 0, default 0.
  if (!isBlank(raw.reorderLevel)) {
    const s = String(raw.reorderLevel).trim();
    if (!/^\d+$/.test(s)) errors.push("reorderLevel must be a whole number >= 0");
    else data.reorderLevel = Number(s);
  }

  // openingStock — optional decimal >= 0, default "0". Kept as a STRING for Decimal128.
  if (!isBlank(raw.openingStock)) {
    const s = String(raw.openingStock).trim();
    if (!DECIMAL_RE.test(s)) errors.push(`openingStock must be a non-negative decimal (got "${s}")`);
    else data.openingQty = s;
  } else {
    data.openingQty = "0";
  }

  // sku — optional. Blank => auto-generate at commit.
  let skuProvided = null;
  if (!isBlank(raw.sku)) {
    const s = String(raw.sku).trim();
    if (!SKU_RE.test(s)) errors.push("sku may contain only letters, numbers, and hyphens (no spaces)");
    else {
      skuProvided = s;
      data.sku = s;
    }
  }

  return {
    rowNumber,
    ok: errors.length === 0,
    errors,
    data: errors.length === 0 ? data : null,
    skuProvided,
    // Best-effort display values, shown in the preview even when the row errors.
    display: {
      name: isBlank(raw.name) ? "" : String(raw.name).trim(),
      categoryName: isBlank(raw.categoryName) ? "" : String(raw.categoryName).trim(),
      sku: skuProvided ?? "(auto)",
    },
  };
}
