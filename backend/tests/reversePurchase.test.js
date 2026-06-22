import test, { before, after, beforeEach, mock } from "node:test";
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
import { reversePurchase } from "../src/services/reversalService.js";
import { recalculateItemCost } from "../src/services/costService.js";
import { recordSupplierPayment } from "../src/services/supplierService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_reverse?replicaSet=rs0";

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

async function newItem(over = {}) {
  const { item } = await createItem(
    { name: "GM wire", categoryId: category._id, baseUnit: "gaz", retailPrice: 15000, ...over },
    { userId }
  );
  return item;
}
const buy = (body) => recordPurchase({ paymentType: "cash", ...body }, { userId });
const fresh = (id) => Item.findById(id);

test("reverse a cash purchase: removes its stock and replays avgCost back", async () => {
  const item = await newItem();
  await buy({ lines: [{ itemId: item._id, qty: "100", unitCost: "11000" }] }); // avg 11000
  const { purchase: p2 } = await buy({ lines: [{ itemId: item._id, qty: "50", unitCost: "12000" }] });
  // after 2 buys: avg 11333.3333333333, stock 150
  assert.equal(decimalToString((await fresh(item._id)).avgCost), "11333.3333333333");

  const { purchase, items } = await reversePurchase(p2._id, { userId });

  assert.equal(purchase.reversed, true);
  assert.ok(purchase.reversedAt);
  // back to exactly the first purchase's state
  assert.equal(decimalToString(items[0].avgCost), "11000");
  assert.equal(decimalToString(items[0].stockQty), "100");
  // a reversing movement was written (negative qty, type reversal)
  const rev = await StockMovement.findOne({ type: "reversal", refId: p2._id });
  assert.ok(rev);
  assert.equal(decimalToString(rev.qty), "-50");
});

test("reverse the canonical ₹36.67 buy → avgCost returns to ₹0", async () => {
  const item = await newItem({ openingQty: "200" }); // opening adjustment @ ₹0
  const { purchase } = await buy({ lines: [{ itemId: item._id, qty: "100", unitCost: "11000" }] });
  assert.equal(decimalToString((await fresh(item._id)).avgCost), "3666.6666666667");

  const { items } = await reversePurchase(purchase._id, { userId });
  assert.equal(decimalToString(items[0].avgCost), "0");
  assert.equal(decimalToString(items[0].stockQty), "200");
});

test("reverse a credit purchase restores supplier.balance", async () => {
  const item = await newItem();
  const supplier = await Supplier.create({ name: "Acme", balance: "0", openingBalance: "0" });
  const { purchase } = await recordPurchase(
    { paymentType: "credit", supplierId: supplier._id, lines: [{ itemId: item._id, qty: "10", unitCost: "5000" }] },
    { userId }
  );
  assert.equal(decimalToString((await Supplier.findById(supplier._id)).balance), "50000"); // owes 50000

  const { supplier: after } = await reversePurchase(purchase._id, { userId });
  assert.equal(decimalToString(after.balance), "0");
});

test("reverse an already-paid credit purchase pushes balance negative (advance/refund due)", async () => {
  const item = await newItem();
  const supplier = await Supplier.create({ name: "Acme", balance: "0", openingBalance: "0" });
  const { purchase } = await recordPurchase(
    { paymentType: "credit", supplierId: supplier._id, lines: [{ itemId: item._id, qty: "10", unitCost: "5000" }] },
    { userId }
  );
  // pay it off in full
  await recordSupplierPayment({ supplierId: supplier._id, amount: "50000" }, { userId });
  assert.equal(decimalToString((await Supplier.findById(supplier._id)).balance), "0");

  const { supplier: after } = await reversePurchase(purchase._id, { userId });
  assert.equal(decimalToString(after.balance), "-50000"); // refund due
});

test("cannot reverse an already-reversed purchase (idempotency)", async () => {
  const item = await newItem();
  const { purchase } = await buy({ lines: [{ itemId: item._id, qty: "10", unitCost: "1000" }] });
  await reversePurchase(purchase._id, { userId });
  await assert.rejects(() => reversePurchase(purchase._id, { userId }), /already reversed/);
});

test("reversal is one transaction — a mid-operation failure persists nothing", async () => {
  const item = await newItem();
  const { purchase } = await buy({ lines: [{ itemId: item._id, qty: "100", unitCost: "11000" }] });
  const beforeStock = decimalToString((await fresh(item._id)).stockQty);

  const m = mock.method(Item, "findById", () => { throw new Error("boom in reverse"); });
  try {
    await assert.rejects(() => reversePurchase(purchase._id, { userId }), /boom/);
  } finally {
    m.mock.restore();
  }

  // nothing changed: purchase not reversed, stock intact, no reversal movement
  assert.equal((await Purchase.findById(purchase._id)).reversed, false);
  assert.equal(decimalToString((await fresh(item._id)).stockQty), beforeStock);
  assert.equal(await StockMovement.countDocuments({ type: "reversal" }), 0);
});

test("recalculate after a reverse finds NO drift (replay auto-excludes the reversed purchase)", async () => {
  // Guards the bug where a standalone replay would add the reversed purchase's
  // cost back in and undo the reversal's correction.
  const item = await newItem();
  await buy({ lines: [{ itemId: item._id, qty: "100", unitCost: "10000" }] }); // ₹100
  const { purchase: b } = await buy({ lines: [{ itemId: item._id, qty: "100", unitCost: "14000" }] }); // ₹120
  await reversePurchase(b._id, { userId });
  assert.equal(decimalToString((await fresh(item._id)).avgCost), "10000"); // corrected to ₹100

  const report = await recalculateItemCost(item._id, { userId });
  assert.equal(report.changed, false, "a reversed item must not drift on recalculate");
  assert.equal(report.after.avgCost, "10000");
  assert.equal(report.after.stockQty, "100");
});

test("reverse not found → 404", async () => {
  await assert.rejects(
    () => reversePurchase(new mongoose.Types.ObjectId(), { userId }),
    (e) => e.status === 404
  );
});
