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
  const r = normalizeRow(raw({ openingStock: "2.5" }), 2);
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
