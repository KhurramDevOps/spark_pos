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
import { aggregateCashFlows } from "../src/services/dailyCloseService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_quicksale?replicaSet=rs0";

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
// Window covering "now" for the cash-flow / gross-profit aggregation (by createdAt).
const wideRange = () => ({ start: new Date(Date.now() - 86400000), end: new Date(Date.now() + 86400000) });

// ─── Slice 2: posting path ────────────────────────────────────────────────

test("SLICE-2 HEADLINE: a quick-only sale writes ZERO StockMovements, no cost basis, no itemId", async () => {
  const { sale } = await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [{ kind: "quick", name: "wall screws", qty: "10", unitPrice: "500" }],
    },
    { userId }
  );

  assert.equal(sale.lines.length, 1);
  const q = sale.lines[0];
  assert.equal(q.kind, "quick");
  assert.equal(q.name, "wall screws");
  assert.equal(q.costAtTime, undefined, "quick line has NO costAtTime (absent, not zero)");
  assert.equal(q.itemId, undefined, "quick line has NO itemId");
  assert.equal(decimalToString(sale.total), "5000"); // 10 * 500

  const movs = await StockMovement.find({ refId: sale._id });
  assert.equal(movs.length, 0, "ZERO StockMovements for a quick-only sale");
});

test("SLICE-2: mixed sale — only the item line moves stock; quick line moves none; total includes quick", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000"); // avgCost ₹100, stock 100

  const { sale } = await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { kind: "item", itemId: item._id, qty: "4", unitPrice: "15000" },
        { kind: "quick", name: "lugs", qty: "10", unitPrice: "500" },
      ],
    },
    { userId }
  );

  // total includes both lines: 4*15000 + 10*500
  assert.equal(decimalToString(sale.total), "65000");

  // exactly one sale movement, for the ITEM line only
  const movs = await StockMovement.find({ type: "sale", refId: sale._id });
  assert.equal(movs.length, 1, "only the item line creates a StockMovement");
  assert.equal(String(movs[0].itemId), String(item._id));

  // only the item line decremented stock (100 - 4); quick line touched nothing
  assert.equal(decimalToString((await fresh(item._id)).stockQty), "96");

  const q = sale.lines.find((l) => l.kind === "quick");
  assert.equal(q.name, "lugs");
  assert.equal(q.costAtTime, undefined);
});

test("SLICE-2: a credit (khata) sale with a quick line owes the full total including quick revenue", async () => {
  const customer = await Customer.create({ name: "Akram", phone: "0300" });
  const { sale, customer: updated } = await recordSale(
    {
      paymentType: "credit",
      priceMode: "retail",
      customerId: customer._id,
      lines: [{ kind: "quick", name: "tape", qty: "3", unitPrice: "2000" }],
    },
    { userId }
  );
  assert.equal(decimalToString(sale.total), "6000");
  assert.equal(decimalToString(updated.balance), "6000", "khata owes the quick revenue");
});

// ─── Slice 3: profit-loop branching (anti-006c) ──────────────────────────────

test("ANTI-006c HEADLINE: a quick line contributes EXACTLY 0 to gross profit — identical to the same sale with the quick line removed", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000"); // avgCost ₹100 (10000 paisa)
  const range = wideRange();

  // (a) a MIXED sale: item line (profit = (15000-10000)*3 = 15000) + a quick line.
  await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { kind: "item", itemId: item._id, qty: "3", unitPrice: "15000" },
        { kind: "quick", name: "screws", qty: "10", unitPrice: "500" }, // +5000 revenue, cost UNKNOWN
      ],
    },
    { userId }
  );
  const withQuick = await aggregateCashFlows(range);

  // (b) THE SAME SALE WITH THE QUICK LINE REMOVED — clear sales, re-post item line only.
  await Sale.deleteMany({});
  await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [{ kind: "item", itemId: item._id, qty: "3", unitPrice: "15000" }],
    },
    { userId }
  );
  const withoutQuick = await aggregateCashFlows(range);

  // THE HEADLINE: gross profit is IDENTICAL with or without the quick line.
  assert.equal(
    withQuick.grossProfit,
    withoutQuick.grossProfit,
    "quick line must change gross profit by exactly 0"
  );
  assert.equal(withQuick.grossProfit, "15000", "gross profit = item line only ((15000-10000)*3)");

  // And the quick revenue is tracked SEPARATELY (never inside gross profit).
  assert.equal(withQuick.quickSalesRevenue, "5000", "quick revenue reported on its own");
});

test("SLICE-3: Expected-cash basis (cashSales) INCLUDES quick revenue while gross profit EXCLUDES it", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const range = wideRange();

  await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { kind: "item", itemId: item._id, qty: "4", unitPrice: "15000" }, // total 60000, profit 20000
        { kind: "quick", name: "lugs", qty: "10", unitPrice: "500" }, // total 5000, profit unknown
      ],
    },
    { userId }
  );

  const f = await aggregateCashFlows(range);
  assert.equal(f.cashSales, "65000", "cash drawer figure includes quick revenue (Sale.total)");
  assert.equal(f.grossProfit, "20000", "gross profit is item line only ((15000-10000)*4)");
  assert.equal(f.quickSalesRevenue, "5000", "quick revenue surfaced separately");
});
