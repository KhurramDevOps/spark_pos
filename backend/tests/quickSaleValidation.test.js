import test from "node:test";
import assert from "node:assert/strict";

import { createSaleSchema } from "../../shared/validation/sale.js";

// Slice 1 (spec 008): the sale-line union. An item line with no `kind` must parse
// exactly as before (backward compat); a quick line carries name + price and no
// itemId; bad shapes are rejected with useful messages.

const base = { paymentType: "cash", priceMode: "retail" };

test("backward compat: a line with NO kind parses as an item line (kind defaults to 'item')", () => {
  const r = createSaleSchema.safeParse({
    ...base,
    lines: [{ itemId: "a".repeat(24), qty: "2", unitPrice: "150" }],
  });
  assert.equal(r.success, true);
  assert.equal(r.data.lines[0].kind, "item");
  assert.equal(r.data.lines[0].itemId, "a".repeat(24));
});

test("a quick line validates with name + qty + unitPrice and no itemId", () => {
  const r = createSaleSchema.safeParse({
    ...base,
    lines: [{ kind: "quick", name: "wall screws", qty: "10", unitPrice: "5" }],
  });
  assert.equal(r.success, true);
  assert.equal(r.data.lines[0].kind, "quick");
  assert.equal(r.data.lines[0].name, "wall screws");
  assert.equal("itemId" in r.data.lines[0], false);
});

test("a mixed sale (item line + quick line) validates", () => {
  const r = createSaleSchema.safeParse({
    ...base,
    lines: [
      { itemId: "a".repeat(24), qty: "1", unitPrice: "1500" },
      { kind: "quick", name: "lugs", qty: "4", unitPrice: "10" },
    ],
  });
  assert.equal(r.success, true);
  assert.equal(r.data.lines[0].kind, "item");
  assert.equal(r.data.lines[1].kind, "quick");
});

test("a quick line with an empty name is rejected", () => {
  const r = createSaleSchema.safeParse({
    ...base,
    lines: [{ kind: "quick", name: "  ", qty: "1", unitPrice: "5" }],
  });
  assert.equal(r.success, false);
});

test("a Rs 0 quick line (giveaway) is allowed; a negative/blank price is not", () => {
  assert.equal(
    createSaleSchema.safeParse({ ...base, lines: [{ kind: "quick", name: "free clip", qty: "1", unitPrice: "0" }] }).success,
    true
  );
  assert.equal(
    createSaleSchema.safeParse({ ...base, lines: [{ kind: "quick", name: "x", qty: "1", unitPrice: "-1" }] }).success,
    false
  );
});

test("an item line still requires a valid itemId", () => {
  const r = createSaleSchema.safeParse({
    ...base,
    lines: [{ kind: "item", itemId: "not-an-id", qty: "1", unitPrice: "10" }],
  });
  assert.equal(r.success, false);
});
