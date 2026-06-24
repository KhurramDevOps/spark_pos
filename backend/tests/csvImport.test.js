import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  validateHeaders,
  normalizeRow,
  HEADERS,
  TEMPLATE_CSV,
} from "../src/lib/csvImport.js";

const HEADER_LINE = HEADERS.join(",");

test("parseCsv strips a leading BOM so the first header is recognized", () => {
  const text = `﻿${HEADER_LINE}\nWidget,Misc,piece,100,,,,`;
  const { fields, rows } = parseCsv(text);
  assert.ok(fields.includes("name"), "name header recognized despite BOM");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Widget");
});

test("parseCsv matches headers case-insensitively and ignores unknown columns", () => {
  const text = `Name,CategoryName,BaseUnit,RetailPrice,colour\nWidget,Misc,piece,100,red`;
  const { fields } = parseCsv(text);
  assert.deepEqual(fields, ["name", "categoryName", "baseUnit", "retailPrice"]);
});

test("validateHeaders rejects a file missing a required column", () => {
  const ok = validateHeaders(["name", "categoryName", "baseUnit", "retailPrice"]);
  assert.equal(ok.ok, true);

  const bad = validateHeaders(["name", "categoryName", "baseUnit"]); // no retailPrice
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing, ["retailPrice"]);
});

test("template has the locked headers in order", () => {
  assert.ok(TEMPLATE_CSV.startsWith(HEADER_LINE));
});

const raw = (over = {}) => ({
  name: "GM 7/29 wire",
  categoryName: "Wire",
  baseUnit: "gaz",
  retailPrice: "120",
  ...over,
});

test("normalizeRow converts rupee prices to integer paisa", () => {
  const r = normalizeRow(raw({ retailPrice: "120.5", wholesalePrice: "110" }), 2);
  assert.equal(r.ok, true);
  assert.equal(r.data.retailPrice, 12050);
  assert.equal(r.data.wholesalePrice, 11000);
});

test("normalizeRow rejects prices with more than 2 decimal places (never rounds)", () => {
  const r = normalizeRow(raw({ retailPrice: "1250.555" }), 2);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /more than 2 decimal places/);
});

test("normalizeRow rejects commas / currency symbols in prices", () => {
  const r = normalizeRow(raw({ retailPrice: "1,250" }), 2);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /no commas or currency symbols/);
});

test("normalizeRow rejects a zero/negative retail price", () => {
  assert.equal(normalizeRow(raw({ retailPrice: "0" }), 2).ok, false);
});

test("normalizeRow: blank optional cell uses default; garbage is an error", () => {
  const blank = normalizeRow(raw({ wholesalePrice: "", reorderLevel: "", openingStock: "" }), 2);
  assert.equal(blank.ok, true);
  assert.equal(blank.data.wholesalePrice, undefined);
  assert.equal(blank.data.reorderLevel, undefined); // createItem applies its own default
  assert.equal(blank.data.openingQty, "0");

  const garbage = normalizeRow(raw({ openingStock: "abc" }), 2);
  assert.equal(garbage.ok, false);
  assert.match(garbage.errors.join(" "), /non-negative decimal/);
});

test("normalizeRow keeps openingStock as a decimal string for Decimal128", () => {
  // openingStock now requires a paired openingUnitCost (006c); pair one to isolate
  // the decimal-string-preservation behavior under test.
  const r = normalizeRow(raw({ openingStock: "2.5", openingUnitCost: "95" }), 2);
  assert.equal(r.data.openingQty, "2.5");
});

test("normalizeRow accepts baseUnit case-insensitively, rejects unknown units", () => {
  assert.equal(normalizeRow(raw({ baseUnit: "Piece" }), 2).data.baseUnit, "piece");
  const bad = normalizeRow(raw({ baseUnit: "litre" }), 2);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /not valid/);
});

test("normalizeRow flags blank required fields and collects ALL errors at once", () => {
  const r = normalizeRow({ name: "", categoryName: "", baseUnit: "", retailPrice: "" }, 2);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
});

test("normalizeRow validates a provided SKU charset", () => {
  assert.equal(normalizeRow(raw({ sku: "WIR-0001" }), 2).skuProvided, "WIR-0001");
  const bad = normalizeRow(raw({ sku: "has space" }), 2);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /letters, numbers, and hyphens/);
});

// --- spec 006c: openingStock + openingUnitCost pairing ---------------------

test("normalizeRow: openingStock + openingUnitCost together → opening cost as paisa string", () => {
  const r = normalizeRow(raw({ openingStock: "10", openingUnitCost: "95" }), 2);
  assert.equal(r.ok, true);
  assert.equal(r.data.openingQty, "10");
  assert.equal(r.data.openingUnitCost, "9500"); // rupees → paisa, kept as a string for Decimal128
});

test("normalizeRow: openingStock alone is now a row-level error (006c breaking change)", () => {
  const r = normalizeRow(raw({ openingStock: "10", openingUnitCost: "" }), 2);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /must be set together.*openingUnitCost is missing/);
});

test("normalizeRow: openingUnitCost alone (no qty) is a row-level error", () => {
  const r = normalizeRow(raw({ openingStock: "", openingUnitCost: "95" }), 2);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /must be set together.*openingStock is missing or 0/);
});

test("normalizeRow: openingStock 0 with a cost is the missing-qty error (0 is not positive)", () => {
  const r = normalizeRow(raw({ openingStock: "0", openingUnitCost: "95" }), 2);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /openingStock is missing or 0/);
});

test("normalizeRow: neither opening column = unchanged behavior (qty 0, no cost)", () => {
  const r = normalizeRow(raw({ openingStock: "", openingUnitCost: "" }), 2);
  assert.equal(r.ok, true);
  assert.equal(r.data.openingQty, "0");
  assert.equal(r.data.openingUnitCost, undefined);
});

test("normalizeRow: zero opening cost is allowed when paired with positive qty (free stock)", () => {
  const r = normalizeRow(raw({ openingStock: "5", openingUnitCost: "0" }), 2);
  assert.equal(r.ok, true);
  assert.equal(r.data.openingQty, "5");
  assert.equal(r.data.openingUnitCost, "0");
});

test("normalizeRow: a garbage openingUnitCost surfaces the money validator error", () => {
  const r = normalizeRow(raw({ openingStock: "5", openingUnitCost: "1,250" }), 2);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /no commas or currency symbols/);
});

test("template row carries an openingUnitCost paired with its openingStock", () => {
  assert.ok(HEADERS.includes("openingUnitCost"));
  const headerCols = TEMPLATE_CSV.split("\n")[0].split(",");
  const firstRow = TEMPLATE_CSV.split("\n")[1].split(",");
  const qtyIdx = headerCols.indexOf("openingStock");
  const costIdx = headerCols.indexOf("openingUnitCost");
  assert.ok(Number(firstRow[qtyIdx]) > 0, "template opening qty is positive");
  assert.ok(Number(firstRow[costIdx]) > 0, "template opening unit cost is set");
});
