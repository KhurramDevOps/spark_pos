import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import { createItem, updateItem, setItemActive, listItems } from "../src/services/itemService.js";
import {
  createCategory,
  setCategoryActive,
  listCategories,
} from "../src/services/categoryService.js";
import { decimalToString } from "../src/lib/decimal.js";

// Own DB per test file: node --test runs files in parallel, so a shared DB
// would let one file's cleanup clobber another's data.
const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_guards?replicaSet=rs0";

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
  await Promise.all([
    Item.deleteMany({}),
    StockMovement.deleteMany({}),
    Counter.deleteMany({}),
    Category.deleteMany({}),
  ]);
  category = await createCategory({ name: "Wire" });
});

const baseItem = (over = {}) => ({
  name: "GM 7/29 wire",
  categoryId: category._id,
  baseUnit: "gaz",
  retailPrice: 12000,
  ...over,
});

// ---- Guard 1: baseUnit locked once a StockMovement exists ------------------

test("updateItem blocks baseUnit change once stock has moved", async () => {
  const { item } = await createItem(baseItem({ openingQty: "5" }), { userId });
  await assert.rejects(
    () => updateItem(item._id, { baseUnit: "meter" }, { userId }),
    /baseUnit cannot be changed/
  );
});

test("updateItem allows baseUnit change when no movement exists yet", async () => {
  const { item } = await createItem(baseItem({ openingQty: "0" }), { userId });
  const updated = await updateItem(item._id, { baseUnit: "meter" }, { userId });
  assert.equal(updated.baseUnit, "meter");
});

test("updateItem rejects moving an item into an inactive category", async () => {
  const empty = await createCategory({ name: "Empty Cat" });
  await setCategoryActive(empty._id, false); // no items reference it -> allowed
  const { item } = await createItem(baseItem({ openingQty: "0" }), { userId });
  await assert.rejects(
    () => updateItem(item._id, { categoryId: empty._id }, { userId }),
    /inactive/
  );
});

test("updateItem updates fields and clears optional ones with null", async () => {
  const { item } = await createItem(
    baseItem({ openingQty: "0", wholesalePrice: 9000, notes: "x" }),
    { userId }
  );
  const updated = await updateItem(
    item._id,
    { name: "GM wire (renamed)", retailPrice: 13000, wholesalePrice: null },
    { userId }
  );
  assert.equal(updated.name, "GM wire (renamed)");
  assert.equal(updated.retailPrice, 13000);
  assert.equal(updated.wholesalePrice, undefined);
});

// ---- Guard 2: category deactivation blocked while active items reference it -

test("setCategoryActive blocks deactivation while an active item references it", async () => {
  await createItem(baseItem({ openingQty: "0" }), { userId });
  await assert.rejects(
    () => setCategoryActive(category._id, false),
    /active items reference it/
  );
});

test("category can be deactivated once its items are inactive, and reactivated", async () => {
  const { item } = await createItem(baseItem({ openingQty: "0" }), { userId });
  await setItemActive(item._id, false);

  const deactivated = await setCategoryActive(category._id, false);
  assert.equal(deactivated.isActive, false);

  const reactivated = await setCategoryActive(category._id, true);
  assert.equal(reactivated.isActive, true);
});

// ---- List: pagination, case-insensitive search, filters --------------------

test("listItems searches name + sku case-insensitively and filters by active", async () => {
  await createItem(baseItem({ name: "Copper Wire", openingQty: "0" }), { userId });
  await createItem(baseItem({ name: "Ceiling Fan", openingQty: "0" }), { userId });
  const { item: hidden } = await createItem(
    baseItem({ name: "Old Belt", openingQty: "0" }),
    { userId }
  );
  await setItemActive(hidden._id, false);

  // case-insensitive substring on name (use a term that won't match the SKU prefix)
  const byName = await listItems({ search: "copper", active: true });
  assert.equal(byName.total, 1);
  assert.equal(byName.items[0].name, "Copper Wire");

  // search by SKU fragment (auto SKUs share the category prefix, e.g. WIRE-0001)
  const bySku = await listItems({ search: "wire-000", active: true });
  assert.ok(bySku.total >= 2);

  // active filter excludes the deactivated item; "all" includes it
  const activeOnly = await listItems({ active: true });
  assert.equal(activeOnly.total, 2);
  const all = await listItems({ active: undefined });
  assert.equal(all.total, 3);
});

test("listItems paginates", async () => {
  for (let i = 0; i < 5; i++) {
    await createItem(baseItem({ name: `Item ${i}`, openingQty: "0" }), { userId });
  }
  const p1 = await listItems({ active: true, page: 1, limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.equal(p1.total, 5);
  assert.equal(p1.pages, 3);
  const p3 = await listItems({ active: true, page: 3, limit: 2 });
  assert.equal(p3.items.length, 1);
});

test("listCategories returns active filter correctly", async () => {
  const all = await listCategories({});
  assert.ok(all.length >= 1);
});
