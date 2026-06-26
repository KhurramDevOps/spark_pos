import test from "node:test";
import assert from "node:assert/strict";

import { saleItemsLabel } from "../../shared/sales/itemsLabel.js";

const line = (name) => ({ itemId: name == null ? null : { name } });

test("single line → just the item name (no '+N more')", () => {
  assert.equal(saleItemsLabel({ lines: [line("GM 7/29 wire")] }), "GM 7/29 wire");
});

test("multiple lines → first name + '+N more' counting the rest", () => {
  assert.equal(
    saleItemsLabel({ lines: [line("Ceiling Fan"), line("Switch"), line("Bulb")] }),
    "Ceiling Fan +2 more"
  );
});

test("two lines → '+1 more' (singular count, not pluralized)", () => {
  assert.equal(saleItemsLabel({ lines: [line("Fan"), line("Switch")] }), "Fan +1 more");
});

test("no lines / missing lines → em dash", () => {
  assert.equal(saleItemsLabel({ lines: [] }), "—");
  assert.equal(saleItemsLabel({}), "—");
  assert.equal(saleItemsLabel(null), "—");
});

test("unpopulated / missing item ref falls back to 'Unknown item'", () => {
  assert.equal(saleItemsLabel({ lines: [line(null)] }), "Unknown item");
  // First line missing but others present still counts the rest.
  assert.equal(saleItemsLabel({ lines: [line(null), line("Switch")] }), "Unknown item +1 more");
});

test("quick line (spec 008): uses the line's own name, no itemId needed", () => {
  // A quick line has no itemId — its stored free-text name is the label.
  assert.equal(saleItemsLabel({ lines: [{ kind: "quick", name: "wall screws" }] }), "wall screws");
  // Mixed: item line first, quick line counted in '+N more'.
  assert.equal(
    saleItemsLabel({ lines: [line("Fan"), { kind: "quick", name: "screws" }] }),
    "Fan +1 more"
  );
  // Quick line first resolves to its name (not "Unknown item").
  assert.equal(saleItemsLabel({ lines: [{ kind: "quick", name: "lugs" }, line("Fan")] }), "lugs +1 more");
});
