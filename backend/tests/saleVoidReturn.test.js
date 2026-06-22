import test, { before, after, beforeEach, mock } from "node:test";
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
import CustomerReturn from "../src/models/CustomerReturn.js";
import { createItem } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { recordSale } from "../src/services/saleService.js";
import { voidSale, recordCustomerReturn } from "../src/services/saleReversalService.js";
import { recalculateItemCost } from "../src/services/costService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_salevoid?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(), Counter.init(),
    Customer.init(), Sale.init(), Purchase.init(), Settings.init(), CustomerReturn.init(),
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
    Purchase.deleteMany({}), Settings.deleteMany({}), CustomerReturn.deleteMany({}),
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

test("void a cash sale restores stock for every line; sale marked voided; avg unchanged", async () => {
  const a = await newItem({ name: "A" });
  const b = await newItem({ name: "B" });
  await stockUp(a, "100", "10000");
  await stockUp(b, "50", "20000");
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [
      { itemId: a._id, qty: "10", unitPrice: "15000" },
      { itemId: b._id, qty: "5", unitPrice: "25000" },
    ] },
    { userId }
  );
  assert.equal(decimalToString((await fresh(a._id)).stockQty), "90");

  const { sale: voided } = await voidSale(sale._id, { userId });
  assert.equal(voided.voided, true);
  assert.ok(voided.voidedAt);
  assert.equal(decimalToString((await fresh(a._id)).stockQty), "100"); // restored
  assert.equal(decimalToString((await fresh(b._id)).stockQty), "50");
  assert.equal(decimalToString((await fresh(a._id)).avgCost), "10000"); // UNCHANGED
  // reversing rows are positive qty, type reversal, no reversalRef
  const rev = await StockMovement.find({ type: "reversal", refId: sale._id });
  assert.equal(rev.length, 2);
  assert.equal(decimalToString(rev[0].qty), "10");
  assert.equal(rev[0].reversalRef, undefined);
});

test("void a credit sale restores stock AND reduces the khata; already-paid => store credit", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const customer = await Customer.create({ name: "Dealer", balance: "0", openingBalance: "0" });
  const { sale } = await recordSale(
    { paymentType: "credit", customerId: customer._id, priceMode: "retail",
      lines: [{ itemId: item._id, qty: "10", unitPrice: "15000" }] },
    { userId }
  );
  assert.equal(decimalToString((await Customer.findById(customer._id)).balance), "150000");

  const { customer: afterVoid } = await voidSale(sale._id, { userId });
  assert.equal(decimalToString(afterVoid.balance), "0");
  assert.equal(decimalToString((await fresh(item._id)).stockQty), "100");

  // already-paid case: a fresh sale, pay it, then void => negative (store credit)
  const { sale: s2 } = await recordSale(
    { paymentType: "credit", customerId: customer._id, priceMode: "retail",
      lines: [{ itemId: item._id, qty: "10", unitPrice: "15000" }] },
    { userId }
  );
  // simulate the customer having paid it off (force the DB value directly)
  await Customer.findByIdAndUpdate(customer._id, { balance: mongoose.Types.Decimal128.fromString("0") });
  const { customer: afterVoid2 } = await voidSale(s2._id, { userId });
  assert.equal(decimalToString(afterVoid2.balance), "-150000"); // store credit
});

test("cannot void an already-voided sale (idempotency)", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "1", unitPrice: "15000" }] },
    { userId }
  );
  await voidSale(sale._id, { userId });
  await assert.rejects(() => voidSale(sale._id, { userId }), /already voided/);
});

test("customer return: cash refund increases stock, no balance effect; avg unchanged", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "10", unitPrice: "15000" }] },
    { userId }
  );
  // stock now 90
  const { customerReturn, customer, items } = await recordCustomerReturn(
    { saleId: sale._id, lines: [{ itemId: item._id, qty: "3" }], refundMethod: "cash" },
    { userId }
  );
  assert.equal(customer, null); // cash refund, no customer
  assert.equal(decimalToString(customerReturn.total), "45000"); // 3 * 15000
  assert.equal(decimalToString(items[0].stockQty), "93"); // 90 + 3
  assert.equal(decimalToString(items[0].avgCost), "10000"); // UNCHANGED
  const mv = await StockMovement.findOne({ type: "return", refId: customerReturn._id });
  assert.equal(decimalToString(mv.qty), "3"); // positive
});

test("customer return: khata-credit reduces the customer's balance", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const customer = await Customer.create({ name: "Dealer", balance: "0", openingBalance: "0" });
  const { sale } = await recordSale(
    { paymentType: "credit", customerId: customer._id, priceMode: "retail",
      lines: [{ itemId: item._id, qty: "10", unitPrice: "15000" }] }, // owes 150000
    { userId }
  );
  const { customer: after } = await recordCustomerReturn(
    { saleId: sale._id, lines: [{ itemId: item._id, qty: "4" }], refundMethod: "khata-credit" },
    { userId }
  );
  assert.equal(decimalToString(after.balance), "90000"); // 150000 - 4*15000
});

test("khata-credit on a cash sale requires (and credits) a customer", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "5", unitPrice: "15000" }] },
    { userId }
  );
  // no customer on the cash sale, none supplied -> rejected
  await assert.rejects(
    () => recordCustomerReturn({ saleId: sale._id, lines: [{ itemId: item._id, qty: "1" }], refundMethod: "khata-credit" }, { userId }),
    /requires a customer/
  );
  // supply one -> it gets credited (negative = store credit)
  const customer = await Customer.create({ name: "Walk-in", balance: "0", openingBalance: "0" });
  const { customer: after } = await recordCustomerReturn(
    { saleId: sale._id, customerId: customer._id, lines: [{ itemId: item._id, qty: "1" }], refundMethod: "khata-credit" },
    { userId }
  );
  assert.equal(decimalToString(after.balance), "-15000"); // store credit
});

test("return qty cap is cumulative across returns on the same sale line", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "5", unitPrice: "15000" }] },
    { userId }
  );
  await recordCustomerReturn({ saleId: sale._id, lines: [{ itemId: item._id, qty: "3" }], refundMethod: "cash" }, { userId });
  // 3 returned; returning 3 more (total 6 > 5 sold) must fail
  await assert.rejects(
    () => recordCustomerReturn({ saleId: sale._id, lines: [{ itemId: item._id, qty: "3" }], refundMethod: "cash" }, { userId }),
    /more than was sold/
  );
  // returning the remaining 2 is fine
  await recordCustomerReturn({ saleId: sale._id, lines: [{ itemId: item._id, qty: "2" }], refundMethod: "cash" }, { userId });
  assert.equal(decimalToString((await fresh(item._id)).stockQty), "100"); // 95 + 3 + 2
});

test("returning an item not on the sale is rejected", async () => {
  const a = await newItem({ name: "A" });
  const b = await newItem({ name: "B" });
  await stockUp(a, "100", "10000");
  await stockUp(b, "100", "10000");
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: a._id, qty: "5", unitPrice: "15000" }] },
    { userId }
  );
  await assert.rejects(
    () => recordCustomerReturn({ saleId: sale._id, lines: [{ itemId: b._id, qty: "1" }], refundMethod: "cash" }, { userId }),
    /not on this sale/
  );
});

test("avgCost untouched + recalculate-cost reports NO drift after void and after return", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000"); // avg 10000, stock 100
  const { sale: s1 } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "20", unitPrice: "15000" }] },
    { userId }
  );
  await voidSale(s1._id, { userId }); // stock back to 100
  let report = await recalculateItemCost(item._id, { userId });
  assert.equal(report.changed, false, "no drift after void");
  assert.equal(report.after.avgCost, "10000");
  assert.equal(report.after.stockQty, "100");

  const { sale: s2 } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "30", unitPrice: "15000" }] },
    { userId }
  ); // stock 70
  await recordCustomerReturn({ saleId: s2._id, lines: [{ itemId: item._id, qty: "10" }], refundMethod: "cash" }, { userId }); // stock 80
  report = await recalculateItemCost(item._id, { userId });
  assert.equal(report.changed, false, "no drift after return");
  assert.equal(report.after.avgCost, "10000");
  assert.equal(report.after.stockQty, "80");
});

test("void is one transaction — a mid-operation failure persists nothing", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const { sale } = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "10", unitPrice: "15000" }] },
    { userId }
  );
  const before = decimalToString((await fresh(item._id)).stockQty);

  const m = mock.method(Item, "findById", () => { throw new Error("boom in void"); });
  try {
    await assert.rejects(() => voidSale(sale._id, { userId }), /boom/);
  } finally {
    m.mock.restore();
  }
  assert.equal((await Sale.findById(sale._id)).voided, false);
  assert.equal(decimalToString((await fresh(item._id)).stockQty), before);
  assert.equal(await StockMovement.countDocuments({ type: "reversal" }), 0);
});
