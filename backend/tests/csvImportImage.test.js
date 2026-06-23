import test from "node:test";
import assert from "node:assert/strict";

import { HEADERS, REQUIRED_HEADERS, normalizeRow } from "../src/lib/csvImport.js";

// Minimal valid row; imageUrl varied per test.
const baseRow = { name: "Fan", categoryName: "Fans", baseUnit: "piece", retailPrice: "150" };

test("imageUrl column exists and is optional (not required)", () => {
  assert.ok(HEADERS.includes("imageUrl"));
  assert.ok(!REQUIRED_HEADERS.includes("imageUrl"));
});

test("a valid imageUrl becomes a url-kind image on the row data", () => {
  const r = normalizeRow({ ...baseRow, imageUrl: "https://cdn.example.com/fan.jpg" }, 2);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.image, { kind: "url", ref: "https://cdn.example.com/fan.jpg" });
});

test("a blank imageUrl leaves the row valid with no image", () => {
  const r = normalizeRow({ ...baseRow, imageUrl: "" }, 2);
  assert.equal(r.ok, true);
  assert.equal(r.data.image, undefined);
});

test("an invalid imageUrl is a row-level error (surfaces in the preview)", () => {
  for (const bad of ["not a url", "javascript:alert(1)", "ftp://x/y.jpg"]) {
    const r = normalizeRow({ ...baseRow, imageUrl: bad }, 2);
    assert.equal(r.ok, false, `expected error for ${bad}`);
    assert.ok(r.errors.some((e) => e.includes("imageUrl")), `expected imageUrl error for ${bad}`);
    assert.equal(r.data, null);
  }
});
