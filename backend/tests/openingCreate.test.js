import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Supplier from "../src/models/Supplier.js";
import { createItem } from "../src/services/itemService.js";
import { recomputeItemCostByReplay } from "../src/services/costService.js";
import { decimalToString } from "../src/lib/decimal.js";
import { createItemSchema } from "../../shared/validation/item.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_opening_create?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Item.init(), Category.init(), StockMovement.init(), Counter.init(), Supplier.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([
    Item.deleteMany({}), StockMovement.deleteMany({}), Counter.deleteMany({}),
    Category.deleteMany({}), Supplier.deleteMany({}),
  ]);
  category = await Category.create({ name: "Wire", skuPrefix: "WIR" });
});

const base = { name: "GM wire", baseUnit: "gaz", retailPrice: 30000 };

test("create with opening qty + cost → one 'opening' movement, avgCost set, no supplier", async () => {
  const { item, openingMovement } = await createItem(
    { ...base, categoryId: category._id, openingQty: "15", openingUnitCost: "20000" }, // Rs 200
    { userId }
  );

  assert.equal(decimalToString(item.stockQty), "15");
  assert.equal(decimalToString(item.avgCost), "20000");
  assert.equal(openingMovement.type, "opening");
  assert.equal(decimalToString(openingMovement.costAtTime), "20000");

  const movements = await StockMovement.find({ itemId: item._id });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type, "opening");
  // no legacy cost-less adjustment was written
  assert.equal(await StockMovement.countDocuments({ itemId: item._id, type: "adjustment" }), 0);
  // replay agrees: avgCost = the opening cost exactly
  const replay = await recomputeItemCostByReplay(item._id);
  assert.equal(replay.avgCost, "20000");
  assert.equal(replay.stockQty, "15");
  // no supplier involvement of any kind
  assert.equal(await Supplier.countDocuments({}), 0);
});

test("create without opening fields → qty 0, avgCost 0, no movement (unchanged)", async () => {
  const { item, openingMovement } = await createItem({ ...base, categoryId: category._id }, { userId });
  assert.equal(decimalToString(item.stockQty), "0");
  assert.equal(decimalToString(item.avgCost), "0");
  assert.equal(openingMovement, null);
  assert.equal(await StockMovement.countDocuments({ itemId: item._id }), 0);
});

test("create with openingUnitCost but no qty → rejected (service guard)", async () => {
  await assert.rejects(
    () => createItem({ ...base, categoryId: category._id, openingUnitCost: "20000" }, { userId }),
    /requires a positive openingQty/
  );
});

test("create rejects a negative opening cost", async () => {
  await assert.rejects(
    () => createItem({ ...base, categoryId: category._id, openingQty: "15", openingUnitCost: "-5" }, { userId }),
    /cannot be negative/
  );
});

test("createItemSchema enforces the qty/cost pairing", () => {
  const ok = { name: "x", categoryId: "0".repeat(24), baseUnit: "gaz", retailPrice: 100, openingQty: "15", openingUnitCost: "20000" };
  assert.equal(createItemSchema.safeParse(ok).success, true);

  // qty without cost → invalid
  const qtyOnly = { ...ok, openingUnitCost: undefined };
  const r1 = createItemSchema.safeParse(qtyOnly);
  assert.equal(r1.success, false);
  assert.ok(r1.error.issues.some((i) => i.path[0] === "openingUnitCost"));

  // cost without qty → invalid
  const costOnly = { ...ok, openingQty: "0" };
  const r2 = createItemSchema.safeParse(costOnly);
  assert.equal(r2.success, false);
  assert.ok(r2.error.issues.some((i) => i.path[0] === "openingQty"));

  // neither → valid (no opening)
  const neither = { name: "x", categoryId: "0".repeat(24), baseUnit: "gaz", retailPrice: 100 };
  assert.equal(createItemSchema.safeParse(neither).success, true);
});
