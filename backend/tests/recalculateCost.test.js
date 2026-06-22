import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Supplier from "../src/models/Supplier.js";
import Purchase from "../src/models/Purchase.js";
import { createItem } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { recalculateItemCost } from "../src/services/costService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_recalc?replicaSet=rs0";

const { Decimal128 } = mongoose.Types;
const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(),
    Counter.init(), Supplier.init(), Purchase.init(),
  ]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([
    Item.deleteMany({}), StockMovement.deleteMany({}), Counter.deleteMany({}),
    Category.deleteMany({}), Supplier.deleteMany({}), Purchase.deleteMany({}),
  ]);
  category = await Category.create({ name: "Wire", skuPrefix: "WIR" });
});

async function newItem() {
  const { item } = await createItem(
    { name: "GM wire", categoryId: category._id, baseUnit: "gaz", retailPrice: 15000 },
    { userId }
  );
  return item;
}

test("repair tool fixes a corrupted avgCost back to the replayed value", async () => {
  const item = await newItem();
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "11000" }] }, { userId });
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "50", unitCost: "12000" }] }, { userId });

  // Corrupt the cached aggregates directly.
  await Item.findByIdAndUpdate(item._id, {
    avgCost: Decimal128.fromString("99999"),
    stockQty: Decimal128.fromString("7"),
  });

  const report = await recalculateItemCost(item._id, { userId });
  assert.equal(report.changed, true);
  assert.equal(report.before.avgCost, "99999");
  assert.equal(report.after.avgCost, "11333.3333333333");
  assert.equal(report.after.stockQty, "150");

  const fresh = await Item.findById(item._id);
  assert.equal(decimalToString(fresh.avgCost), "11333.3333333333");
  assert.equal(decimalToString(fresh.stockQty), "150");
});

test("repair tool is a no-op (changed=false) when there is no drift", async () => {
  const item = await newItem();
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "10", unitCost: "5000" }] }, { userId });

  const report = await recalculateItemCost(item._id, { userId });
  assert.equal(report.changed, false);
  assert.equal(report.before.avgCost, report.after.avgCost);
  assert.equal(report.before.stockQty, report.after.stockQty);
});

test("repair tool 404s for a missing item", async () => {
  await assert.rejects(
    () => recalculateItemCost(new mongoose.Types.ObjectId(), { userId }),
    (e) => e.status === 404
  );
});
