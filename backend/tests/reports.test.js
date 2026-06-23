import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Sale from "../src/models/Sale.js";
import CustomerReturn from "../src/models/CustomerReturn.js";
import Expense from "../src/models/Expense.js";
import Customer from "../src/models/Customer.js";
import Supplier from "../src/models/Supplier.js";
import Item from "../src/models/Item.js";
import { resolveWindow, karachiYMDLabel } from "../src/lib/businessDay.js";
import {
  windowTotals,
  aggregateTrend,
  aggregateItemPerformance,
  aggregateDeadStock,
  aggregateExpenseBreakdown,
  aggregateKhata,
  getReport,
} from "../src/services/reportsService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_reports?replicaSet=rs0";

const { ObjectId } = mongoose.Types;
const userId = new ObjectId();
const U = (s) => new Date(s);

// Karachi (UTC+5) reference instants used below:
//   2026-06-23 13:00 Karachi = 2026-06-23T08:00:00Z
//   2026-06-23 23:55 Karachi = 2026-06-23T18:55:00Z  -> Karachi day Jun 23
//   2026-06-24 00:30 Karachi = 2026-06-23T19:30:00Z  -> Karachi day Jun 24
const JUN23 = U("2026-06-23T08:00:00Z");
const JUL10 = U("2026-07-10T08:00:00Z");

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Sale.init(), CustomerReturn.init(), Expense.init(), Customer.init(), Supplier.init(), Item.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([
    Sale.deleteMany({}), CustomerReturn.deleteMany({}), Expense.deleteMany({}),
    Customer.deleteMany({}), Supplier.deleteMany({}), Item.deleteMany({}),
  ]);
});

async function at(doc, createdAt) {
  doc.createdAt = createdAt;
  doc.updatedAt = createdAt;
  await doc.save({ timestamps: false });
  return doc;
}
const categoryId = new ObjectId();
function mkItem({ name, sku, stock, avgCost = "100" }) {
  return new Item({ name, sku, categoryId, baseUnit: "piece", retailPrice: 150, wholesalePrice: 120, avgCost, stockQty: String(stock) });
}
// one-line cash sale of `item`, qty at unitPrice (cost = item avg basis passed explicitly)
function saleOf(item, { qty, price, cost, createdAt, voided = false }) {
  const lineTotal = String(Number(qty) * Number(price));
  return new Sale({
    date: createdAt, paymentType: "cash", priceMode: "retail",
    lines: [{ itemId: item._id, qty: String(qty), unitPrice: String(price), suggestedPrice: String(price), costAtTime: String(cost), lineTotal }],
    total: lineTotal, voided, createdBy: userId,
  });
}
function returnOf(sale, item, { qty, value, createdAt, refundMethod = "cash" }) {
  return new CustomerReturn({
    saleId: sale._id, date: createdAt,
    lines: [{ itemId: item._id, qty: String(qty), valueAtTime: String(value) }],
    total: String(Number(qty) * Number(value)), refundMethod, createdBy: userId,
  });
}

// ---- Window resolvers -----------------------------------------------------

test("resolveWindow: this_month + prior across a year boundary", () => {
  const now = U("2026-01-05T08:00:00Z"); // Karachi Jan 5 2026
  const w = resolveWindow({ window: "this_month" }, now);
  assert.equal(karachiYMDLabel(w.start), "2026-01-01");
  assert.equal(karachiYMDLabel(w.end), "2026-01-31");
  assert.equal(karachiYMDLabel(w.prior.start), "2025-12-01");
  assert.equal(karachiYMDLabel(w.prior.end), "2025-12-31");
});

test("resolveWindow: this_week is Mon–Sun, prior is the preceding week", () => {
  const now = U("2026-06-24T08:00:00Z"); // Karachi Wed Jun 24 2026 (Jun 22 is Monday)
  const w = resolveWindow({ window: "this_week" }, now);
  assert.equal(karachiYMDLabel(w.start), "2026-06-22");
  assert.equal(karachiYMDLabel(w.end), "2026-06-28");
  assert.equal(karachiYMDLabel(w.prior.start), "2026-06-15");
  assert.equal(karachiYMDLabel(w.prior.end), "2026-06-21");
});

test("resolveWindow: today→yesterday; last_month; custom length-1 prior is the day before", () => {
  const now = U("2026-06-23T08:00:00Z");
  const today = resolveWindow({ window: "today" }, now);
  assert.equal(karachiYMDLabel(today.start), "2026-06-23");
  assert.equal(karachiYMDLabel(today.prior.start), "2026-06-22");

  const lm = resolveWindow({ window: "last_month" }, now);
  assert.equal(karachiYMDLabel(lm.start), "2026-05-01");
  assert.equal(karachiYMDLabel(lm.end), "2026-05-31");
  assert.equal(karachiYMDLabel(lm.prior.start), "2026-04-01");

  const c = resolveWindow({ window: "custom", start: "2026-06-10", end: "2026-06-10" });
  assert.equal(karachiYMDLabel(c.start), "2026-06-10");
  assert.equal(karachiYMDLabel(c.end), "2026-06-10");
  assert.equal(karachiYMDLabel(c.prior.start), "2026-06-09");
  assert.equal(karachiYMDLabel(c.prior.end), "2026-06-09");
});

test("resolveWindow rejects unknown window and malformed custom", () => {
  assert.throws(() => resolveWindow({ window: "decade" }), /unknown report window/);
  assert.throws(() => resolveWindow({ window: "custom", start: "nope", end: "2026-01-01" }), /YYYY-MM-DD/);
  assert.throws(() => resolveWindow({ window: "custom", start: "2026-06-10", end: "2026-06-09" }), /on or after/);
});

// ---- Aggregation ----------------------------------------------------------

test("range-parameterization regression: per-day trend sums to the single-range totals", async () => {
  const a = await at(mkItem({ name: "Fan", sku: "F1", stock: 5 }), JUN23);
  // three sales across three Karachi days in June
  await at(saleOf(a, { qty: 1, price: 150, cost: 100, createdAt: U("2026-06-21T08:00:00Z") }), U("2026-06-21T08:00:00Z"));
  await at(saleOf(a, { qty: 2, price: 150, cost: 100, createdAt: U("2026-06-22T08:00:00Z") }), U("2026-06-22T08:00:00Z"));
  await at(saleOf(a, { qty: 1, price: 150, cost: 100, createdAt: JUN23 }), JUN23);
  await at(new Expense({ date: JUN23, category: "other", amount: "500", createdBy: userId }), JUN23);

  const range = resolveWindow({ window: "this_month" }, JUN23);
  const totals = await windowTotals(range);
  const trend = await aggregateTrend(range);

  const sum = (k) => trend.reduce((s, d) => s + Number(d[k]), 0);
  assert.equal(sum("profit"), Number(totals.grossProfit));
  assert.equal(sum("revenue"), Number(totals.revenue));
  assert.equal(sum("expenses"), Number(totals.expenses));
  // sanity: 4 sold @ (150-100) = 200 profit; revenue 4*150=600; expenses 500; net -300
  assert.equal(totals.grossProfit, "200");
  assert.equal(totals.revenue, "600");
  assert.equal(totals.net, "-300");
});

test("return-netting across the window boundary: sale in June, return in July hits July", async () => {
  const a = await at(mkItem({ name: "Fan", sku: "F1", stock: 5 }), JUN23);
  const sale = await at(saleOf(a, { qty: 2, price: 150, cost: 100, createdAt: JUN23 }), JUN23); // June
  await at(returnOf(sale, a, { qty: 1, value: 150, createdAt: JUL10 }), JUL10); // July

  const july = resolveWindow({ window: "this_month" }, JUL10);
  const totals = await windowTotals(july);
  // July has no sales, one return: revenue = 0 - 150; profit = 0 - (150-100) = -50
  assert.equal(totals.revenue, "-150");
  assert.equal(totals.grossProfit, "-50");

  const perf = await aggregateItemPerformance(july);
  const row = perf.rows.find((r) => r.itemId === String(a._id));
  assert.equal(row.qtySold, "-1");
  assert.equal(row.revenue, "-150");
  assert.equal(row.grossProfit, "-50");

  // and June still shows the full original sale
  const june = resolveWindow({ window: "this_month" }, JUN23);
  assert.equal((await windowTotals(june)).grossProfit, "100"); // 2 * (150-100)
});

test("item performance nets returns within a window (sell 10, return 2 → qty 8)", async () => {
  const a = await at(mkItem({ name: "Wire", sku: "W1", stock: 50 }), JUN23);
  const sale = await at(saleOf(a, { qty: 10, price: 150, cost: 100, createdAt: JUN23 }), JUN23);
  await at(returnOf(sale, a, { qty: 2, value: 150, createdAt: JUN23 }), JUN23);

  const perf = await aggregateItemPerformance(resolveWindow({ window: "this_month" }, JUN23));
  const row = perf.rows.find((r) => r.itemId === String(a._id));
  assert.equal(row.qtySold, "8");
  assert.equal(row.grossProfit, "400"); // 8 * (150-100)
});

test("dead stock is voided-aware: a voided-only sale leaves the item dead", async () => {
  const sold = await at(mkItem({ name: "Sold", sku: "S1", stock: 5 }), JUN23);
  const deadVoid = await at(mkItem({ name: "VoidedOnly", sku: "V1", stock: 7 }), JUN23);
  const deadNever = await at(mkItem({ name: "NeverSold", sku: "N1", stock: 3 }), JUN23);
  const zeroStock = await at(mkItem({ name: "ZeroStock", sku: "Z1", stock: 0 }), JUN23);

  await at(saleOf(sold, { qty: 1, price: 150, cost: 100, createdAt: JUN23 }), JUN23);
  await at(saleOf(deadVoid, { qty: 1, price: 150, cost: 100, createdAt: JUN23, voided: true }), JUN23);

  const range = resolveWindow({ window: "this_month" }, JUN23);
  const perf = await aggregateItemPerformance(range);
  const dead = await aggregateDeadStock(range, perf.soldItemIds);
  const skus = dead.map((d) => d.sku).sort();
  assert.deepEqual(skus, ["N1", "V1"]); // sold excluded; zero-stock excluded; voided-only IS dead
});

test("expense breakdown by category sums to the headline expenses", async () => {
  await at(new Expense({ date: JUN23, category: "salary", amount: "15000", createdBy: userId }), JUN23);
  await at(new Expense({ date: JUN23, category: "electricity", amount: "3000", createdBy: userId }), JUN23);
  await at(new Expense({ date: JUN23, category: "other", amount: "500", createdBy: userId }), JUN23);

  const range = resolveWindow({ window: "this_month" }, JUN23);
  const breakdown = await aggregateExpenseBreakdown(range);
  const sum = breakdown.reduce((s, b) => s + Number(b.total), 0);
  assert.equal(sum, Number((await windowTotals(range)).expenses));
  assert.equal(breakdown[0].category, "salary"); // sorted desc by total
});

test("khata ranking: by absolute value, sign preserved, owed ≠ credit", async () => {
  await Customer.create({ name: "A", balance: "1000" });
  await Customer.create({ name: "B", balance: "500" });
  await Customer.create({ name: "C", balance: "-300" }); // store credit
  await Customer.create({ name: "D", balance: "0" }); // excluded
  await Supplier.create({ name: "S1", balance: "-700" });

  const k = await aggregateKhata();
  assert.deepEqual(k.customers.owed.map((r) => r.name), ["A", "B"]);
  assert.deepEqual(k.customers.credit.map((r) => r.name), ["C"]);
  assert.equal(k.customers.owed[0].balance, "1000");
  assert.equal(k.customers.credit[0].balance, "-300"); // sign preserved
  // owed and credit are genuinely different sets, not the same list re-sorted
  assert.equal(k.customers.owed.some((r) => r.name === "C"), false);
  assert.deepEqual(k.suppliers.credit.map((r) => r.name), ["S1"]);
  assert.deepEqual(k.suppliers.owed, []);
});

test("prior-window delta: prior-zero yields null pct (no div-by-zero), abs still computed", async () => {
  const a = await at(mkItem({ name: "Fan", sku: "F1", stock: 5 }), JUL10);
  await at(saleOf(a, { qty: 2, price: 150, cost: 100, createdAt: JUL10 }), JUL10); // July only; June (prior) empty

  const report = await getReport({ window: "this_month" }, JUL10);
  const gp = report.headline.grossProfit;
  assert.equal(gp.value, "100");
  assert.equal(gp.delta.priorZero, true);
  assert.equal(gp.delta.pct, null); // would have divided by zero
  assert.equal(gp.delta.abs, "100"); // 100 - 0
});

test("trend buckets by Karachi day boundary (11:55pm lands in its own day)", async () => {
  const a = await at(mkItem({ name: "Fan", sku: "F1", stock: 5 }), JUN23);
  await at(saleOf(a, { qty: 1, price: 150, cost: 100, createdAt: U("2026-06-23T18:55:00Z") }), U("2026-06-23T18:55:00Z")); // Karachi Jun 23 23:55
  await at(saleOf(a, { qty: 1, price: 150, cost: 100, createdAt: U("2026-06-23T19:30:00Z") }), U("2026-06-23T19:30:00Z")); // Karachi Jun 24 00:30

  const range = resolveWindow({ window: "custom", start: "2026-06-23", end: "2026-06-23" });
  const trend = await aggregateTrend(range);
  assert.equal(trend.length, 1);
  assert.equal(trend[0].date, "2026-06-23");
  assert.equal(trend[0].profit, "50"); // only the 23:55 sale; the 00:30 one is Jun 24
});
