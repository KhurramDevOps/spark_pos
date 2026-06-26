import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Customer from "../src/models/Customer.js";
import Sale from "../src/models/Sale.js";
import Purchase from "../src/models/Purchase.js";
import Settings from "../src/models/Settings.js";
import { createItem } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { recordSale } from "../src/services/saleService.js";
import { voidSale } from "../src/services/saleReversalService.js";
import { aggregateItemPerformance } from "../src/services/reportsService.js";
import { getDayClose } from "../src/services/dailyCloseService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_quicksale_rep?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(), Counter.init(),
    Customer.init(), Sale.init(), Purchase.init(), Settings.init(),
  ]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([
    Item.deleteMany({}), StockMovement.deleteMany({}), Counter.deleteMany({}),
    Category.deleteMany({}), Customer.deleteMany({}), Sale.deleteMany({}),
    Purchase.deleteMany({}), Settings.deleteMany({}),
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
async function stockUp(item, qty, unitCost) {
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty, unitCost }] }, { userId });
  return Item.findById(item._id);
}
const fresh = (id) => Item.findById(id);
const todayRange = () => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return { start, end };
};

// ─── void path (spec 008 slice 4) ────────────────────────────────────────────

test("void a mixed sale: stock restored for the item line ONLY; quick line has no stock side-effect", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000"); // stock 100

  const { sale } = await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { kind: "item", itemId: item._id, qty: "4", unitPrice: "15000" },
        { kind: "quick", name: "screws", qty: "10", unitPrice: "500" },
      ],
    },
    { userId }
  );
  assert.equal(decimalToString((await fresh(item._id)).stockQty), "96"); // item line sold

  await voidSale(sale._id, { userId });

  // stock fully restored from the item line; the quick line never moved stock
  assert.equal(decimalToString((await fresh(item._id)).stockQty), "100");
  // exactly one reversal movement (item line); none for the quick line
  const reversals = await StockMovement.find({ type: "reversal", refId: sale._id });
  assert.equal(reversals.length, 1);
  assert.equal(String(reversals[0].itemId), String(item._id));
  assert.equal((await Sale.findById(sale._id)).voided, true);
});

test("void a quick-ONLY credit sale: khata undone via total, zero stock movements", async () => {
  const customer = await Customer.create({ name: "Akram", phone: "0300" });
  const { sale } = await recordSale(
    {
      paymentType: "credit",
      priceMode: "retail",
      customerId: customer._id,
      lines: [{ kind: "quick", name: "tape", qty: "3", unitPrice: "2000" }],
    },
    { userId }
  );
  assert.equal(decimalToString((await Customer.findById(customer._id)).balance), "6000");

  const { customer: after } = await voidSale(sale._id, { userId });

  assert.equal(decimalToString(after.balance), "0", "khata reversed by the full total");
  assert.equal(await StockMovement.countDocuments({ refId: sale._id }), 0, "no stock movements at all");
});

// ─── reporting aggregates (spec 008 slice 4) ─────────────────────────────────

test("item performance: quick lines roll up into one aggregate, never a per-item row", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");

  await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { kind: "item", itemId: item._id, qty: "4", unitPrice: "15000" },
        { kind: "quick", name: "screws", qty: "10", unitPrice: "500" },
        { kind: "quick", name: "lugs", qty: "2", unitPrice: "1000" },
      ],
    },
    { userId }
  );

  const perf = await aggregateItemPerformance(todayRange());
  // exactly one catalogued row (the item), no quick rows mixed in
  assert.equal(perf.rows.length, 1);
  assert.equal(String(perf.rows[0].itemId), String(item._id));
  // quick aggregate: 10 + 2 = 12 qty, 5000 + 2000 = 7000 revenue, 2 lines
  assert.equal(decimalToString(perf.quick.qtySold), "12");
  assert.equal(decimalToString(perf.quick.revenue), "7000");
  assert.equal(perf.quick.lineCount, 2);
});

test("daily close surfaces quick-sale revenue + line count; net excludes it, expected cash includes it", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");

  await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { kind: "item", itemId: item._id, qty: "4", unitPrice: "15000" }, // profit 20000
        { kind: "quick", name: "screws", qty: "10", unitPrice: "500" }, // revenue 5000
      ],
    },
    { userId }
  );

  const dc = await getDayClose(new Date());
  assert.equal(dc.quickSalesRevenue, "5000", "quick revenue surfaced");
  assert.equal(dc.quickSalesCount, 1, "quick line count surfaced");
  assert.equal(dc.grossProfit, "20000", "gross profit excludes quick (item line only)");
  assert.equal(dc.netForDay, "20000", "net = grossProfit - expenses (0) — excludes quick, not cash-based");
  assert.equal(dc.cashSales, "65000", "expected-cash basis includes quick revenue (Sale.total)");
});
