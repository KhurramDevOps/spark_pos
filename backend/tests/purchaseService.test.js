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
import { recordPurchase, applyPurchaseToCost } from "../src/services/purchaseService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_purchases?replicaSet=rs0";

const { Decimal128 } = mongoose.Types;
const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(),
    Category.init(),
    StockMovement.init(),
    Counter.init(),
    Supplier.init(),
    Purchase.init(),
  ]);
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
    Supplier.deleteMany({}),
    Purchase.deleteMany({}),
  ]);
  category = await Category.create({ name: "Wire", skuPrefix: "WIR" });
});

// Create a zero-stock item (no opening movement) to start cost history clean.
async function newItem(over = {}) {
  const { item } = await createItem(
    { name: "GM wire", categoryId: category._id, baseUnit: "gaz", retailPrice: 15000, ...over },
    { userId }
  );
  return item;
}

// ---- pure cost math -------------------------------------------------------

test("applyPurchaseToCost: first purchase sets avg = unitCost (oldQty 0)", () => {
  const r = applyPurchaseToCost("0", "0", "100", "11000");
  assert.deepEqual(r, { newAvg: "11000", newStock: "100" });
});

test("applyPurchaseToCost: weighted-average worked example", () => {
  const r = applyPurchaseToCost("100", "11000", "50", "12000");
  assert.equal(r.newAvg, "11333.3333333333");
  assert.equal(r.newStock, "150");
});

test("applyPurchaseToCost: negative oldQty floors to 0 and never divides by zero", () => {
  // oldQty -50, buy 50 -> real stock 0, but avg = unitCost (effectiveOld floored)
  const r = applyPurchaseToCost("-50", "5000", "50", "9000");
  assert.equal(r.newAvg, "9000");
  assert.equal(r.newStock, "0");
});

// ---- recordPurchase (transactional) ---------------------------------------

test("two purchases move avgCost by the weighted average and raise stock", async () => {
  const item = await newItem();

  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "100", unitCost: "11000" }] },
    { userId }
  );
  let fresh = await Item.findById(item._id);
  assert.equal(decimalToString(fresh.avgCost), "11000");
  assert.equal(decimalToString(fresh.stockQty), "100");

  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "50", unitCost: "12000" }] },
    { userId }
  );
  fresh = await Item.findById(item._id);
  assert.equal(decimalToString(fresh.avgCost), "11333.3333333333");
  assert.equal(decimalToString(fresh.stockQty), "150");
});

test("each line writes a purchase StockMovement with costAtTime + refId + createdBy", async () => {
  const item = await newItem();
  const { purchase } = await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "10", unitCost: "5000" }] },
    { userId }
  );

  const mv = await StockMovement.findOne({ itemId: item._id, type: "purchase" });
  assert.ok(mv);
  assert.equal(decimalToString(mv.qty), "10");
  assert.equal(decimalToString(mv.costAtTime), "5000");
  assert.equal(String(mv.refId), String(purchase._id));
  assert.equal(String(mv.createdBy), String(userId));
});

test("duplicate item across two lines: line 2 builds on line 1's running average", async () => {
  const item = await newItem();
  const { purchase } = await recordPurchase(
    {
      paymentType: "cash",
      lines: [
        { itemId: item._id, qty: "100", unitCost: "11000" },
        { itemId: item._id, qty: "50", unitCost: "12000" },
      ],
    },
    { userId }
  );

  const fresh = await Item.findById(item._id);
  assert.equal(decimalToString(fresh.avgCost), "11333.3333333333");
  assert.equal(decimalToString(fresh.stockQty), "150");
  assert.equal(await StockMovement.countDocuments({ itemId: item._id, type: "purchase" }), 2);
  assert.equal(decimalToString(purchase.total), "1700000"); // 100*11000 + 50*12000
});

test("total is whole paisa while lineTotal keeps full precision", async () => {
  const item = await newItem();
  const { purchase } = await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "0.333", unitCost: "11050" }] },
    { userId }
  );
  assert.equal(decimalToString(purchase.lines[0].lineTotal), "3679.65"); // exact
  assert.equal(decimalToString(purchase.total), "3680"); // rounded payable
});

test("the whole purchase is one transaction — a mid-purchase failure persists nothing", async () => {
  const a = await newItem({ name: "A" });
  const b = await newItem({ name: "B" });

  const realCreate = StockMovement.create;
  const m = mock.method(StockMovement, "create", () => {
    throw new Error("boom writing movements");
  });

  try {
    await assert.rejects(
      () =>
        recordPurchase(
          {
            paymentType: "cash",
            lines: [
              { itemId: a._id, qty: "5", unitCost: "1000" },
              { itemId: b._id, qty: "5", unitCost: "1000" },
            ],
          },
          { userId }
        ),
      /boom/
    );
  } finally {
    m.mock.restore();
    void realCreate;
  }

  assert.equal(await Purchase.countDocuments({}), 0, "no purchase should persist");
  assert.equal(decimalToString((await Item.findById(a._id)).stockQty), "0");
  assert.equal(decimalToString((await Item.findById(b._id)).stockQty), "0");
  assert.equal(await StockMovement.countDocuments({}), 0);
});

test("credit purchase requires a supplier and increases that supplier's balance", async () => {
  const item = await newItem();
  const supplier = await Supplier.create({ name: "Acme", balance: Decimal128.fromString("0") });

  await recordPurchase(
    {
      paymentType: "credit",
      supplierId: supplier._id,
      lines: [{ itemId: item._id, qty: "10", unitCost: "5000" }],
    },
    { userId }
  );

  const fresh = await Supplier.findById(supplier._id);
  assert.equal(decimalToString(fresh.balance), "50000"); // 10 * 5000

  await assert.rejects(
    () =>
      recordPurchase(
        { paymentType: "credit", lines: [{ itemId: item._id, qty: "1", unitCost: "5000" }] },
        { userId }
      ),
    /requires a supplier/
  );
});

test("cash purchase needs no supplier; unitCost 0 is allowed (samples)", async () => {
  const item = await newItem();
  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "5", unitCost: "0" }] },
    { userId }
  );
  const fresh = await Item.findById(item._id);
  assert.equal(decimalToString(fresh.avgCost), "0");
  assert.equal(decimalToString(fresh.stockQty), "5");
});

test("rejects qty <= 0, negative unitCost, and inactive items", async () => {
  const item = await newItem();
  await assert.rejects(
    () => recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "0", unitCost: "1" }] }, { userId }),
    /qty must be greater than 0/
  );
  await assert.rejects(
    () => recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "1", unitCost: "-1" }] }, { userId }),
    /unitCost cannot be negative/
  );

  item.isActive = false;
  await item.save();
  await assert.rejects(
    () => recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty: "1", unitCost: "1" }] }, { userId }),
    /inactive/
  );
});

test("negative-stock item: a purchase floors cost and posts without dividing by zero", async () => {
  const item = await newItem();
  item.stockQty = Decimal128.fromString("-50");
  item.avgCost = Decimal128.fromString("5000");
  await item.save();

  await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: item._id, qty: "50", unitCost: "9000" }] },
    { userId }
  );

  const fresh = await Item.findById(item._id);
  assert.equal(decimalToString(fresh.avgCost), "9000");
  assert.equal(decimalToString(fresh.stockQty), "0");
});
