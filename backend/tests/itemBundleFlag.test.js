import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import { createItem, updateItem } from "../src/services/itemService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_bundle_flag?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Item.init(), Category.init(), StockMovement.init(), Counter.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([Item.deleteMany({}), StockMovement.deleteMany({}), Counter.deleteMany({}), Category.deleteMany({})]);
  category = await Category.create({ name: "Wire", skuPrefix: "WIR" });
});

const wire = (over = {}) => ({ name: "GM wire", categoryId: category._id, baseUnit: "gaz", retailPrice: 1100, ...over });

test("a gaz item can be created with bundle = true", async () => {
  const { item } = await createItem(wire({ bundle: true }), { userId });
  assert.equal(item.bundle, true);
});

test("bundle defaults to false", async () => {
  const { item } = await createItem(wire(), { userId });
  assert.equal(item.bundle, false);
});

test("bundle is REJECTED on a non-gaz item (bundle ⇒ baseUnit gaz)", async () => {
  await assert.rejects(
    () => createItem(wire({ baseUnit: "piece", bundle: true }), { userId }),
    /gaz/i
  );
});

test("flipping the bundle flag on an existing item mutates NO stored value (migration safety)", async () => {
  // Item declared with opening stock + cost, the old way (plain gaz item).
  const { item } = await createItem(wire({ openingQty: "450", openingUnitCost: "1000" }), { userId });
  const before = await Item.findById(item._id).lean();

  await updateItem(item._id, { bundle: true }, { userId });
  const after = await Item.findById(item._id).lean();

  // The flag flipped…
  assert.equal(after.bundle, true);
  // …but stockQty / avgCost / retailPrice are byte-identical — no reinterpretation.
  assert.equal(decimalToString(after.stockQty), decimalToString(before.stockQty)); // still 450 gaz
  assert.equal(decimalToString(after.avgCost), decimalToString(before.avgCost));
  assert.equal(after.retailPrice, before.retailPrice);
});

test("updateItem rejects setting bundle = true when the item is not gaz", async () => {
  const { item } = await createItem(wire({ baseUnit: "piece" }), { userId });
  await assert.rejects(() => updateItem(item._id, { bundle: true }, { userId }), /gaz/i);
});
