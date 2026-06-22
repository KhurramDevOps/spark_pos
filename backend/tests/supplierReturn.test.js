import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Supplier from "../src/models/Supplier.js";
import Purchase from "../src/models/Purchase.js";
import SupplierReturn from "../src/models/SupplierReturn.js";
import { createItem } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { recordSupplierReturn } from "../src/services/reversalService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_return?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(),
    Counter.init(), Supplier.init(), Purchase.init(), SupplierReturn.init(),
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
    SupplierReturn.deleteMany({}),
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
const fresh = (id) => Item.findById(id);

test("return reduces stock at current avg; avgCost unchanged; payable drops", async () => {
  const item = await newItem();
  const supplier = await Supplier.create({ name: "Acme", balance: "0", openingBalance: "0" });
  // buy on credit: 100 @ ₹110 then 50 @ ₹120 -> avg 11333.3333333333, stock 150, owe 1700000
  await recordPurchase(
    { paymentType: "credit", supplierId: supplier._id, lines: [{ itemId: item._id, qty: "100", unitCost: "11000" }] },
    { userId }
  );
  await recordPurchase(
    { paymentType: "credit", supplierId: supplier._id, lines: [{ itemId: item._id, qty: "50", unitCost: "12000" }] },
    { userId }
  );
  const avgBefore = decimalToString((await fresh(item._id)).avgCost);
  assert.equal(avgBefore, "11333.3333333333");

  const { supplierReturn, items, supplier: after } = await recordSupplierReturn(
    { supplierId: supplier._id, lines: [{ itemId: item._id, qty: "30" }] },
    { userId }
  );

  // avg unchanged, stock down 30
  assert.equal(decimalToString(items[0].avgCost), avgBefore);
  assert.equal(decimalToString(items[0].stockQty), "120");
  // return value = 30 * 11333.3333333333 = 339999.999999 -> whole paisa 340000
  assert.equal(decimalToString(supplierReturn.total), "340000");
  // payable was 1700000, drops by 340000 -> 1360000
  assert.equal(decimalToString(after.balance), "1360000");
  assert.equal(supplierReturn.refundDue, false);
  // a return ledger row exists (negative qty)
  const mv = await StockMovement.findOne({ type: "return", itemId: item._id });
  assert.equal(decimalToString(mv.qty), "-30");
  assert.equal(decimalToString(mv.costAtTime), avgBefore);
});

test("return beyond the payable drives balance negative and flags refundDue", async () => {
  const item = await newItem();
  const supplier = await Supplier.create({ name: "Acme", balance: "0", openingBalance: "0" });
  // cash buy (no payable) so any return value pushes balance negative
  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "10000" }] },
    { userId }
  );
  const { supplierReturn, supplier: after } = await recordSupplierReturn(
    { supplierId: supplier._id, lines: [{ itemId: item._id, qty: "10" }] }, // 10 * 10000 = 100000
    { userId }
  );
  assert.equal(decimalToString(after.balance), "-100000"); // refund due
  assert.equal(supplierReturn.refundDue, true);
});

test("return is allowed to drive stock negative (surfaced, not blocked)", async () => {
  const item = await newItem();
  const supplier = await Supplier.create({ name: "Acme", balance: "0", openingBalance: "0" });
  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "10", unitCost: "5000" }] },
    { userId }
  );
  const { items } = await recordSupplierReturn(
    { supplierId: supplier._id, lines: [{ itemId: item._id, qty: "25" }] }, // more than on hand
    { userId }
  );
  assert.equal(decimalToString(items[0].stockQty), "-15");
});

test("return is one transaction — a mid-operation failure persists nothing", async () => {
  const item = await newItem();
  const supplier = await Supplier.create({ name: "Acme", balance: "0", openingBalance: "0" });
  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "5000" }] },
    { userId }
  );
  const beforeStock = decimalToString((await fresh(item._id)).stockQty);

  const m = mock.method(StockMovement, "create", () => { throw new Error("boom in return"); });
  try {
    await assert.rejects(
      () => recordSupplierReturn({ supplierId: supplier._id, lines: [{ itemId: item._id, qty: "10" }] }, { userId }),
      /boom/
    );
  } finally {
    m.mock.restore();
  }

  assert.equal(await SupplierReturn.countDocuments({}), 0);
  assert.equal(await StockMovement.countDocuments({ type: "return" }), 0);
  assert.equal(decimalToString((await fresh(item._id)).stockQty), beforeStock);
  assert.equal(decimalToString((await Supplier.findById(supplier._id)).balance), "0");
});

test("return requires an existing supplier", async () => {
  const item = await newItem();
  await assert.rejects(
    () => recordSupplierReturn({ supplierId: new mongoose.Types.ObjectId(), lines: [{ itemId: item._id, qty: "1" }] }, { userId }),
    /supplier not found/
  );
});
