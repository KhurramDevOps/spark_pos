import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Sale from "../src/models/Sale.js";
import CustomerPayment from "../src/models/CustomerPayment.js";
import SupplierPayment from "../src/models/SupplierPayment.js";
import CustomerReturn from "../src/models/CustomerReturn.js";
import Expense from "../src/models/Expense.js";
import DrawerAdjustment from "../src/models/DrawerAdjustment.js";
import DayClose from "../src/models/DayClose.js";
import { getDayClose, saveDayClose, aggregateCashFlows } from "../src/services/dailyCloseService.js";
import { resolveKarachiDay } from "../src/lib/businessDay.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_dailyclose?replicaSet=rs0";

const { ObjectId } = mongoose.Types;
const userId = new ObjectId();
const U = (s) => new Date(s); // UTC ISO instant

// Karachi (UTC+5) reference instants:
//   June 23 midday  = 2026-06-23T08:00:00Z (Karachi 13:00)
//   June 22 midday  = 2026-06-22T08:00:00Z
//   June 23 23:55   = 2026-06-23T18:55:00Z  -> Karachi day 23
//   June 24 00:30   = 2026-06-23T19:30:00Z  -> Karachi day 24
const J23 = U("2026-06-23T08:00:00Z");
const J22 = U("2026-06-22T08:00:00Z");

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Sale.init(), CustomerPayment.init(), SupplierPayment.init(), CustomerReturn.init(),
    Expense.init(), DrawerAdjustment.init(), DayClose.init(),
  ]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([
    Sale.deleteMany({}), CustomerPayment.deleteMany({}), SupplierPayment.deleteMany({}),
    CustomerReturn.deleteMany({}), Expense.deleteMany({}), DrawerAdjustment.deleteMany({}),
    DayClose.deleteMany({}),
  ]);
});

// Save a doc with an explicit createdAt (bypassing auto-timestamps).
async function at(doc, createdAt) {
  doc.createdAt = createdAt;
  doc.updatedAt = createdAt;
  await doc.save({ timestamps: false });
  return doc;
}
function saleDoc({ total, createdAt, voided = false, lines, paymentType = "cash" }) {
  const ls = lines ?? [{ itemId: new ObjectId(), qty: "1", unitPrice: String(total), suggestedPrice: String(total), costAtTime: "0", lineTotal: String(total) }];
  return new Sale({ date: createdAt, paymentType, priceMode: "retail", lines: ls, total: String(total), voided, createdBy: userId });
}

test("cash math: every line aggregates and expected = X + A + B + C − D − E − F − G", async () => {
  await at(saleDoc({ total: 120000, createdAt: J23 }), J23); // +cash sale
  await at(new CustomerPayment({ customerId: new ObjectId(), amount: "50000", date: J23, createdBy: userId }), J23); // +B
  await at(new SupplierPayment({ supplierId: new ObjectId(), amount: "30000", date: J23, createdBy: userId }), J23); // -E
  await at(new CustomerReturn({ saleId: new ObjectId(), lines: [{ itemId: new ObjectId(), qty: "1", valueAtTime: "10000" }], total: "10000", refundMethod: "cash", createdBy: userId }), J23); // -D
  await at(new Expense({ category: "salary", amount: "20000", date: J23, createdBy: userId }), J23); // -F
  await at(new DrawerAdjustment({ direction: "in", amount: "40000", date: J23, createdBy: userId }), J23); // +C
  await at(new DrawerAdjustment({ direction: "out", amount: "15000", date: J23, createdBy: userId }), J23); // -G

  const v = await getDayClose("2026-06-23");
  assert.equal(v.cashSales, "120000");
  assert.equal(v.customerPayments, "50000");
  assert.equal(v.supplierPayments, "30000");
  assert.equal(v.cashRefunds, "10000");
  assert.equal(v.expenses, "20000");
  assert.equal(v.drawerIn, "40000");
  assert.equal(v.drawerOut, "15000");
  assert.equal(v.startingCash, "0");
  // 0 + 120000 + 50000 + 40000 − 10000 − 30000 − 20000 − 15000 = 135000
  assert.equal(v.expectedCash, "135000");
});

test("timezone: 11:55pm Karachi lands on its day; 00:30am next-day does NOT", async () => {
  await at(saleDoc({ total: 1000, createdAt: U("2026-06-23T18:55:00Z") }), U("2026-06-23T18:55:00Z")); // Karachi 23rd 23:55
  await at(saleDoc({ total: 2000, createdAt: U("2026-06-23T19:30:00Z") }), U("2026-06-23T19:30:00Z")); // Karachi 24th 00:30

  assert.equal((await getDayClose("2026-06-23")).cashSales, "1000"); // only the 23:55 one
  assert.equal((await getDayClose("2026-06-24")).cashSales, "2000"); // only the 00:30 one
});

test("voided sales are excluded from cash sales", async () => {
  await at(saleDoc({ total: 50000, createdAt: J23 }), J23);
  await at(saleDoc({ total: 90000, createdAt: J23, voided: true }), J23);
  assert.equal((await getDayClose("2026-06-23")).cashSales, "50000");
});

test("all customer + supplier payments count as cash (no method field — ADR-009)", async () => {
  await at(new CustomerPayment({ customerId: new ObjectId(), amount: "11111", date: J23, createdBy: userId }), J23);
  await at(new SupplierPayment({ supplierId: new ObjectId(), amount: "22222", date: J23, createdBy: userId }), J23);
  const v = await getDayClose("2026-06-23");
  assert.equal(v.customerPayments, "11111");
  assert.equal(v.supplierPayments, "22222");
});

test("cash refunds line excludes khata-credit returns", async () => {
  await at(new CustomerReturn({ saleId: new ObjectId(), lines: [{ itemId: new ObjectId(), qty: "1", valueAtTime: "5000" }], total: "5000", refundMethod: "cash", createdBy: userId }), J23);
  await at(new CustomerReturn({ saleId: new ObjectId(), lines: [{ itemId: new ObjectId(), qty: "1", valueAtTime: "8000" }], total: "8000", refundMethod: "khata-credit", createdBy: userId }), J23);
  assert.equal((await getDayClose("2026-06-23")).cashRefunds, "5000");
});

test("carried-forward float + walk-back + un-closed-days hint", async () => {
  // first-ever: no close -> starting 0
  assert.equal((await getDayClose("2026-06-23")).startingCash, "0");

  // a close for June 22 -> June 23 starts from it
  await saveDayClose("2026-06-22", { actualCash: "80000" }, { userId });
  assert.equal((await getDayClose("2026-06-23")).startingCash, "80000");

  // remove it, leave only a June 20 close -> June 23 walks back to it, hint = 2 un-closed days
  await DayClose.deleteMany({});
  await saveDayClose("2026-06-20", { actualCash: "70000" }, { userId });
  const v = await getDayClose("2026-06-23");
  assert.equal(v.startingCash, "70000");
  assert.equal(v.unClosedDays, 2);
});

test("return-day profit reversal: a return reduces profit on the RETURN's day, not the sale's", async () => {
  const itemId = new ObjectId();
  const line = { itemId, qty: "10", unitPrice: "15000", suggestedPrice: "15000", costAtTime: "10000", lineTotal: "150000" };
  const sale = await at(saleDoc({ total: 150000, createdAt: J22, lines: [line] }), J22); // June 22 sale, profit 50000
  assert.equal((await getDayClose("2026-06-22")).grossProfit, "50000");

  // return 4 units on June 23 -> reverses 4*(15000-10000)=20000 on June 23
  await at(new CustomerReturn({ saleId: sale._id, lines: [{ itemId, qty: "4", valueAtTime: "15000" }], total: "60000", refundMethod: "cash", createdBy: userId }), J23);
  assert.equal((await getDayClose("2026-06-22")).grossProfit, "50000"); // sale day unchanged
  assert.equal((await getDayClose("2026-06-23")).grossProfit, "-20000"); // reversal hits return day
});

test("DayClose is idempotent per Karachi day (two saves on same day = one row)", async () => {
  await saveDayClose("2026-06-23", { actualCash: "10000" }, { userId });
  // a different UTC instant that is still Karachi June 23 (22:00 Karachi = 17:00 UTC)
  await saveDayClose(U("2026-06-23T17:00:00Z"), { actualCash: "12345" }, { userId });
  const { start } = resolveKarachiDay("2026-06-23");
  assert.equal(await DayClose.countDocuments({ date: start }), 1);
  assert.equal(await DayClose.countDocuments({}), 1);
  assert.equal((await getDayClose("2026-06-23")).close.actualCash, "12345"); // updated
});

test("stale close does NOT change carry-forward actualCash", async () => {
  const sale = await at(saleDoc({ total: 100000, createdAt: J22 }), J22);
  await saveDayClose("2026-06-22", { actualCash: "90000" }, { userId }); // expected snapshot includes the sale
  let v22 = await getDayClose("2026-06-22");
  assert.equal(v22.close.stale, false);

  // retroactively void the June 22 sale -> live expected changes, snapshot doesn't
  sale.voided = true;
  await sale.save({ timestamps: false });

  v22 = await getDayClose("2026-06-22");
  assert.equal(v22.close.stale, true); // flagged
  assert.equal(v22.close.actualCash, "90000"); // counted cash NEVER recomputed
  assert.equal((await getDayClose("2026-06-23")).startingCash, "90000"); // carry-forward stays correct
});
