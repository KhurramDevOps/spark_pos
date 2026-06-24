import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Supplier from "../src/models/Supplier.js";
import Purchase from "../src/models/Purchase.js";
import Customer from "../src/models/Customer.js";
import SupplierPayment from "../src/models/SupplierPayment.js";
import CustomerPayment from "../src/models/CustomerPayment.js";
import DrawerAdjustment from "../src/models/DrawerAdjustment.js";
import { createItem } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { repairOpeningCost } from "../src/services/costService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_opening_repair?replicaSet=rs0";

// All money is integer paisa (Rs × 100): Rs 250 = 25000, Rs 125 = 12500.
const RS_250 = "25000";
const RS_125 = "12500";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(), Counter.init(),
    Supplier.init(), Purchase.init(), Customer.init(),
    SupplierPayment.init(), CustomerPayment.init(), DrawerAdjustment.init(),
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
    Customer.deleteMany({}), SupplierPayment.deleteMany({}),
    CustomerPayment.deleteMany({}), DrawerAdjustment.deleteMany({}),
  ]);
  category = await Category.create({ name: "Wire", skuPrefix: "WIR" });
});

// A clean item (qty 0 / avgCost 0) — the pre-006c default create.
async function newItem() {
  const { item } = await createItem(
    { name: "GM wire", categoryId: category._id, baseUnit: "gaz", retailPrice: 15000 },
    { userId }
  );
  return item;
}

const openingCount = (itemId) =>
  StockMovement.countDocuments({ itemId, type: "opening" });
const legacyCount = (itemId) =>
  StockMovement.countDocuments({ itemId, type: "adjustment", note: "opening stock" });

/**
 * Reconstruct EXACTLY what an item looked like in the live DB before slice 2:
 * a cost-less `adjustment` noted "opening stock" for +15 and stockQty 15, then a
 * real purchase of +15 @ Rs 250. The legacy create wrote no cost, so the purchase
 * dilutes avgCost to the wrong Rs 125 — the owner's actual bug.
 */
async function setupLegacyCorruptedItem() {
  const item = await newItem();
  await StockMovement.create([
    { itemId: item._id, qty: "15", type: "adjustment", note: "opening stock", createdBy: userId },
  ]);
  await Item.findByIdAndUpdate(item._id, { stockQty: "15" }); // avgCost stays 0
  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "15", unitCost: RS_250 }] },
    { userId }
  );
  return item;
}

test("HEADLINE: legacy adjustment + purchase — repair fixes the real bug (no double-count)", async () => {
  const item = await setupLegacyCorruptedItem();

  // Sanity: the dilution bug is present — avgCost is the wrong Rs 125, qty 30.
  const corrupt = await Item.findById(item._id);
  assert.equal(decimalToString(corrupt.avgCost), RS_125, "precondition: diluted to Rs 125");
  assert.equal(decimalToString(corrupt.stockQty), "30");
  assert.equal(await legacyCount(item._id), 1, "precondition: legacy adjustment present");

  const report = await repairOpeningCost(
    item._id,
    { unitCost: RS_250, qty: "15", note: "real cost was Rs 250 each" },
    { userId }
  );

  // Exactly one opening, legacy adjustment deleted.
  assert.equal(await openingCount(item._id), 1, "exactly one opening movement");
  assert.equal(await legacyCount(item._id), 0, "legacy adjustment is gone");

  // stockQty = 30 (15 opening + 15 purchase), NOT 45 (which is what stacking on
  // top of the un-deleted legacy adjustment would give). avgCost = Rs 250.
  const fixed = await Item.findById(item._id);
  assert.equal(decimalToString(fixed.stockQty), "30", "stock is 30, not 45");
  assert.equal(decimalToString(fixed.avgCost), RS_250, "avgCost corrected to Rs 250");

  assert.equal(report.before.avgCost, RS_125);
  assert.equal(report.after.avgCost, RS_250);
  assert.equal(report.changed, true);
});

test("repair on an item with an existing 'opening' movement replaces it cleanly", async () => {
  // Item declared the new (correct) way: a real cost-bearing opening movement.
  const { item } = await createItem(
    {
      name: "Cable", categoryId: category._id, baseUnit: "gaz", retailPrice: 15000,
      openingQty: "10", openingUnitCost: "20000", // Rs 200
    },
    { userId }
  );
  assert.equal(await openingCount(item._id), 1);

  await repairOpeningCost(
    item._id,
    { unitCost: RS_250, qty: "10", note: "actually paid Rs 250" },
    { userId }
  );

  assert.equal(await openingCount(item._id), 1, "still exactly one opening after replace");
  const fixed = await Item.findById(item._id);
  assert.equal(decimalToString(fixed.avgCost), RS_250);
  assert.equal(decimalToString(fixed.stockQty), "10");
});

test("repair on an item with only purchases creates an opening ordered first", async () => {
  const item = await newItem();
  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "10", unitCost: RS_250 }] },
    { userId }
  );

  await repairOpeningCost(
    item._id,
    { unitCost: "20000", qty: "5", note: "found 5 more from before" }, // Rs 200
    { userId }
  );

  assert.equal(await openingCount(item._id), 1);
  // The opening is the FIRST event in posting order.
  const [first] = await StockMovement.find({ itemId: item._id })
    .sort({ createdAt: 1, _id: 1 }).limit(1).lean();
  assert.equal(first.type, "opening");

  // Replay: opening 5 @ Rs 200, then purchase 10 @ Rs 250 → (5×200 + 10×250)/15.
  const fixed = await Item.findById(item._id);
  assert.equal(decimalToString(fixed.stockQty), "15");
  assert.equal(decimalToString(fixed.avgCost), "23333.3333333333");
});

test("IDEMPOTENT: running the repair twice yields the same final state", async () => {
  const item = await setupLegacyCorruptedItem();
  const args = { unitCost: RS_250, qty: "15", note: "real cost Rs 250" };

  const first = await repairOpeningCost(item._id, args, { userId });
  const second = await repairOpeningCost(item._id, args, { userId });

  assert.equal(await openingCount(item._id), 1, "no second opening accumulates");
  assert.equal(await legacyCount(item._id), 0);
  assert.equal(second.after.avgCost, first.after.avgCost);
  assert.equal(second.after.stockQty, first.after.stockQty);

  const fixed = await Item.findById(item._id);
  assert.equal(decimalToString(fixed.avgCost), RS_250);
  assert.equal(decimalToString(fixed.stockQty), "30", "stock did not compound");
});

test("repair rejects an empty note", async () => {
  const item = await newItem();
  await assert.rejects(
    () => repairOpeningCost(item._id, { unitCost: RS_250, qty: "5", note: "  " }, { userId }),
    (e) => e.status === 400 && /note is required/.test(e.message)
  );
});

test("repair touches NO supplier / customer / cash-drawer records", async () => {
  const item = await setupLegacyCorruptedItem();

  const snapshot = async () => ({
    suppliers: await Supplier.countDocuments({}),
    customers: await Customer.countDocuments({}),
    supplierPayments: await SupplierPayment.countDocuments({}),
    customerPayments: await CustomerPayment.countDocuments({}),
    drawerAdjustments: await DrawerAdjustment.countDocuments({}),
  });

  const before = await snapshot();
  await repairOpeningCost(
    item._id,
    { unitCost: RS_250, qty: "15", note: "no money side effects" },
    { userId }
  );
  const afterCounts = await snapshot();

  assert.deepEqual(afterCounts, before, "an opening is a declaration, not a purchase");
});

test("repair runs in a SINGLE transaction (pure replay, not the recalc wrapper)", async () => {
  // recalculateItemCost opens its OWN session; the pure recomputeItemCostByReplay
  // does not. So a correct repair starts exactly ONE session. If it wrongly nested
  // the recalc wrapper, startSession would fire twice.
  const item = await setupLegacyCorruptedItem();

  const real = mongoose.startSession.bind(mongoose);
  const spy = mock.method(mongoose, "startSession", (...a) => real(...a));
  try {
    await repairOpeningCost(
      item._id,
      { unitCost: RS_250, qty: "15", note: "single txn" },
      { userId }
    );
  } finally {
    spy.mock.restore();
  }

  assert.equal(spy.mock.callCount(), 1, "exactly one transaction — no nested recalc wrapper");
});
