import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Customer from "../src/models/Customer.js";
import Sale from "../src/models/Sale.js";
import Settings from "../src/models/Settings.js";
import { createItem, searchItems } from "../src/services/itemService.js";
import { recordSale, getSale } from "../src/services/saleService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_quick_promote?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Item.init(), Category.init(), StockMovement.init(), Counter.init(), Customer.init(), Sale.init(), Settings.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([
    Item.deleteMany({}), StockMovement.deleteMany({}), Counter.deleteMany({}),
    Category.deleteMany({}), Customer.deleteMany({}), Sale.deleteMany({}), Settings.deleteMany({}),
  ]);
  category = await Category.create({ name: "Bits", skuPrefix: "BIT" });
});

// "Promote" is forward-only (ADR-007 / ADR-016): cataloguing a quick item creates a
// NEW Item for future sales — it must NOT retro-assign a cost to, or otherwise alter,
// the historical quick line whose profit is genuinely unknown.
test("cataloguing an item with a quick line's name leaves the past quick line untouched", async () => {
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ kind: "quick", name: "Wall plug", qty: "10", unitPrice: "500" }] },
    { userId }
  );
  const before = await getSale(sale._id);
  const beforeLine = before.lines[0];
  assert.equal(beforeLine.kind, "quick");
  assert.equal(beforeLine.costAtTime, undefined); // no cost basis — the whole point
  assert.equal(beforeLine.itemId, undefined);

  // Owner catalogues a real item of the same name (the promote action's only effect).
  const { item } = await createItem(
    { name: "Wall plug", categoryId: category._id, baseUnit: "piece", retailPrice: 500 },
    { userId }
  );
  assert.ok(item._id);

  // The historical quick line is byte-for-byte unchanged — still cost-less, still quick.
  const after = await getSale(sale._id);
  const afterLine = after.lines[0];
  assert.equal(afterLine.kind, "quick");
  assert.equal(afterLine.costAtTime, undefined);
  assert.equal(afterLine.itemId, undefined);
  assert.equal(afterLine.name, "Wall plug");

  // …and the new item is now findable for FUTURE sales.
  const found = await searchItems({ query: "wall plug" });
  assert.ok(found.items.some((it) => String(it._id) === String(item._id)));
});
