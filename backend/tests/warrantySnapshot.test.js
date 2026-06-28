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
import { createItem, updateItem } from "../src/services/itemService.js";
import { recordSale, getSale } from "../src/services/saleService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_warranty?replicaSet=rs0";

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
  category = await Category.create({ name: "Fans", skuPrefix: "FAN" });
});

const fanTerms = [
  { label: "motor", durationValue: 10, durationUnit: "years" },
  { label: "fan kit", durationValue: 1, durationUnit: "years" },
];

async function newItem(over = {}) {
  const { item } = await createItem(
    { name: "Pedestal Fan", categoryId: category._id, baseUnit: "piece", retailPrice: 50000, ...over },
    { userId }
  );
  return item;
}

test("an item persists multiple warranty terms with different durations", async () => {
  const item = await newItem({ warranties: fanTerms });
  const fresh = await Item.findById(item._id).lean();
  assert.equal(fresh.warranties.length, 2);
  assert.deepEqual(
    fresh.warranties.map((w) => [w.label, w.durationValue, w.durationUnit]),
    [["motor", 10, "years"], ["fan kit", 1, "years"]]
  );
});

test("selling an item snapshots its warranty terms onto the sale line", async () => {
  const item = await newItem({ warranties: fanTerms });
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "1", unitPrice: "50000" }] },
    { userId }
  );
  const line = sale.lines[0];
  assert.equal(line.warranties.length, 2);
  assert.deepEqual(
    line.warranties.map((w) => [w.label, w.durationValue, w.durationUnit]),
    [["motor", 10, "years"], ["fan kit", 1, "years"]]
  );
});

test("REGRESSION: editing the item's warranties does NOT change a past sale's snapshot", async () => {
  const item = await newItem({ warranties: fanTerms });
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "1", unitPrice: "50000" }] },
    { userId }
  );

  // Owner later shortens the motor warranty and drops the fan kit term entirely.
  await updateItem(item._id, { warranties: [{ label: "motor", durationValue: 2, durationUnit: "years" }] }, { userId });

  // The past sale's snapshot is frozen — still the ORIGINAL two terms at original durations.
  const reread = await getSale(sale._id);
  const line = reread.lines[0];
  assert.deepEqual(
    line.warranties.map((w) => [w.label, w.durationValue, w.durationUnit]),
    [["motor", 10, "years"], ["fan kit", 1, "years"]]
  );
  // …while the live item now reflects the edit.
  const liveItem = await Item.findById(item._id).lean();
  assert.equal(liveItem.warranties.length, 1);
  assert.equal(liveItem.warranties[0].durationValue, 2);
});

test("an item with no warranties produces a line carrying none", async () => {
  const item = await newItem(); // no warranties
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "1", unitPrice: "50000" }] },
    { userId }
  );
  const line = sale.lines[0];
  assert.ok(!line.warranties || line.warranties.length === 0);
});

test("quick lines never carry warranties", async () => {
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ kind: "quick", name: "loose screws", qty: "5", unitPrice: "1000" }] },
    { userId }
  );
  const line = sale.lines[0];
  assert.equal(line.kind, "quick");
  assert.ok(line.warranties === undefined || line.warranties.length === 0);
});
