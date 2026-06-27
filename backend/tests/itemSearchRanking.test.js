import test from "node:test";
import assert from "node:assert/strict";

import { tokenize, rankItemMatches } from "../src/lib/itemSearch.js";

// Compact item builder: name, sku, category name.
const it = (name, sku, cat) => ({ name, sku, categoryId: cat ? { name: cat } : null });
const names = (res) => res.map((r) => r.name);

test("tokenize splits on any non-alphanumeric separator and lowercases", () => {
  assert.deepEqual(tokenize("AC/DC"), ["ac", "dc"]);
  assert.deepEqual(tokenize(" Red-Wire, 3mm "), ["red", "wire", "3mm"]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   "), []);
});

test("every query token must match (AND) — a color is NOT surfaced by 'ac/dc'", () => {
  const items = [
    it("AC/DC Heavy Wire", "WIRE-ACDC-1", "Wires"),
    it("Black Insulation Tape", "TAPE-BLK", "Tapes"), // 'black' contains 'ac' but not 'dc'
  ];
  // "ac/dc" → tokens [ac, dc]. Tape matches neither as a word-prefix → excluded.
  assert.deepEqual(names(rankItemMatches(items, "ac/dc")), ["AC/DC Heavy Wire"]);
});

test("a category-only match is surfaced (item name need not contain the query)", () => {
  const items = [
    it("Fan Capacitor", "CAP-1", "AC/DC"), // name has neither token; category has both
    it("Ceiling Fan", "FAN-1", "Fans"),
  ];
  assert.deepEqual(names(rankItemMatches(items, "ac/dc")), ["Fan Capacitor"]);
});

test("a name match ranks ABOVE a category-only match", () => {
  const items = [
    it("Fan Capacitor", "CAP-1", "AC/DC"), // matches via category only
    it("AC Power Cord", "CORD-1", "Cords"), // 'ac' is a name word
  ];
  // Query "ac" → the name-word match should win the top slot.
  assert.deepEqual(names(rankItemMatches(items, "ac")), ["AC Power Cord", "Fan Capacitor"]);
});

test("an exact name match ranks first", () => {
  const items = [
    it("Fan Regulator", "REG-1", "Fans"),
    it("Fan", "FAN-1", "Fans"),
    it("Fancy Light", "LIGHT-1", "Lights"),
  ];
  assert.equal(names(rankItemMatches(items, "fan"))[0], "Fan");
});

test("prefix typing matches mid-search (POS norm): 'cei' → Ceiling Fan", () => {
  const items = [it("Ceiling Fan", "CF-1", "Fans"), it("Table Fan", "TF-1", "Fans")];
  assert.deepEqual(names(rankItemMatches(items, "cei")), ["Ceiling Fan"]);
});

test("sku is searchable", () => {
  const items = [it("Heavy Wire", "ACDC-700", "Wires"), it("Light Wire", "LW-1", "Wires")];
  assert.deepEqual(names(rankItemMatches(items, "acdc")), ["Heavy Wire"]);
});

test("limit caps the result count, keeping the highest-ranked", () => {
  const items = [
    it("Fan", "F-0", "Fans"), // exact → top
    it("Fan A", "F-1", "Fans"),
    it("Fan B", "F-2", "Fans"),
    it("Fan C", "F-3", "Fans"),
  ];
  const res = rankItemMatches(items, "fan", 2);
  assert.equal(res.length, 2);
  assert.equal(res[0].name, "Fan"); // exact match retained
});

test("a blank or whitespace query returns nothing (picker shows no list)", () => {
  const items = [it("Fan", "F-1", "Fans")];
  assert.deepEqual(rankItemMatches(items, ""), []);
  assert.deepEqual(rankItemMatches(items, "   "), []);
});
