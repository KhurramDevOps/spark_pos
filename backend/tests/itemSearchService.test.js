import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import { createItem, searchItems, setItemActive } from "../src/services/itemService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_item_search?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Item.init(), Category.init(), StockMovement.init(), Counter.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([
    Item.deleteMany({}),
    StockMovement.deleteMany({}),
    Counter.deleteMany({}),
    Category.deleteMany({}),
  ]);
});

async function seed() {
  const acdc = await Category.create({ name: "AC/DC", skuPrefix: "ACD" });
  const tapes = await Category.create({ name: "Tapes", skuPrefix: "TAP" });
  const cords = await Category.create({ name: "Cords", skuPrefix: "COR" });
  await createItem({ name: "Fan Capacitor", categoryId: acdc._id, baseUnit: "piece", retailPrice: 25000 }, { userId });
  await createItem({ name: "AC Power Cord", categoryId: cords._id, baseUnit: "piece", retailPrice: 40000 }, { userId });
  await createItem({ name: "Black Insulation Tape", categoryId: tapes._id, baseUnit: "piece", retailPrice: 8000 }, { userId });
  return { acdc };
}

const names = (res) => res.items.map((i) => i.name);

test("category-aware: 'ac/dc' surfaces the category's items, not an incidental color match", async () => {
  await seed();
  const res = await searchItems({ query: "ac/dc" });
  // Fan Capacitor (category AC/DC) is in; Black Tape ('ac' in 'black', no 'dc') is out.
  assert.ok(names(res).includes("Fan Capacitor"));
  assert.ok(!names(res).includes("Black Insulation Tape"));
});

test("a name-word match ranks above a category-only match for 'ac'", async () => {
  await seed();
  const res = await searchItems({ query: "ac" });
  assert.equal(names(res)[0], "AC Power Cord"); // name word 'ac' beats category-only 'Fan Capacitor'
});

test("inactive items are excluded from search results", async () => {
  const { acdc } = await seed();
  const extra = await createItem(
    { name: "AC Spare (retired)", categoryId: acdc._id, baseUnit: "piece", retailPrice: 5000 },
    { userId }
  );
  await setItemActive(extra.item._id, false);
  const res = await searchItems({ query: "ac" });
  assert.ok(!names(res).includes("AC Spare (retired)"));
});

test("a blank query returns no items (no full-table dump)", async () => {
  await seed();
  assert.deepEqual((await searchItems({ query: "" })).items, []);
  assert.deepEqual((await searchItems({ query: "   " })).items, []);
});

test("returned items carry the fields the POS needs (price, stock, category)", async () => {
  await seed();
  const res = await searchItems({ query: "cord" });
  const cord = res.items.find((i) => i.name === "AC Power Cord");
  assert.equal(cord.retailPrice, 40000);
  assert.ok(cord.stockQty !== undefined);
  assert.equal(cord.categoryId.name, "Cords"); // category populated
});
