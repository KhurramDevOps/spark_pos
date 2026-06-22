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
import { createItem } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { recordSale, getSale } from "../src/services/saleService.js";
import { recordCustomerPayment } from "../src/services/customerService.js";
import { recomputeItemCostByReplay, recalculateItemCost } from "../src/services/costService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_sales?replicaSet=rs0";

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
// Set an item's avgCost + stock via a real cash purchase.
async function stockUp(item, qty, unitCost) {
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty, unitCost }] }, { userId });
  return Item.findById(item._id);
}
const fresh = (id) => Item.findById(id);
const lineProfit = (l) =>
  (Number(decimalToString(l.unitPrice)) - Number(decimalToString(l.costAtTime))) * Number(decimalToString(l.qty));

test("cash sale, multiple lines, no customer: stock drops, cost snapshot + profit, avg unchanged", async () => {
  const a = await newItem({ name: "A" });
  const b = await newItem({ name: "B" });
  await stockUp(a, "100", "10000"); // avg ₹100
  await stockUp(b, "50", "20000"); // avg ₹200

  const { sale, customer } = await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { itemId: a._id, qty: "10", unitPrice: "15000" },
        { itemId: b._id, qty: "5", unitPrice: "25000" },
      ],
    },
    { userId }
  );

  assert.equal(customer, null);
  assert.equal(decimalToString(sale.total), "275000"); // 10*15000 + 5*25000
  // line cost snapshots + profit
  assert.equal(decimalToString(sale.lines[0].costAtTime), "10000");
  assert.equal(lineProfit(sale.lines[0]), 50000); // (15000-10000)*10
  assert.equal(decimalToString(sale.lines[1].costAtTime), "20000");
  assert.equal(lineProfit(sale.lines[1]), 25000); // (25000-20000)*5
  // stock dropped
  assert.equal(decimalToString((await fresh(a._id)).stockQty), "90");
  assert.equal(decimalToString((await fresh(b._id)).stockQty), "45");
  // avgCost UNCHANGED by the sale
  assert.equal(decimalToString((await fresh(a._id)).avgCost), "10000");
  assert.equal(decimalToString((await fresh(b._id)).avgCost), "20000");
  // two sale movements, negative qty
  const movs = await StockMovement.find({ type: "sale", refId: sale._id }).sort({ _id: 1 });
  assert.equal(movs.length, 2);
  assert.equal(decimalToString(movs[0].qty), "-10");
  assert.equal(decimalToString(movs[1].qty), "-5");
});

test("avgCost unchanged by sale AND replay/recalculate stay correct (sale movements qty-only)", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000"); // avg ₹100, stock 100
  await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "30", unitPrice: "18000" }] },
    { userId }
  );

  const after = await fresh(item._id);
  assert.equal(decimalToString(after.avgCost), "10000");
  assert.equal(decimalToString(after.stockQty), "70");

  // Replay over a history that includes a sale movement: avg unchanged, stock = 70.
  const replay = await recomputeItemCostByReplay(item._id);
  assert.equal(replay.avgCost, "10000");
  assert.equal(replay.stockQty, "70");
  // The repair tool reports no drift.
  const report = await recalculateItemCost(item._id, { userId });
  assert.equal(report.changed, false);
});

test("suggestedPrice: retail vs wholesale, wholesale falls back to retail when unset", async () => {
  const item = await newItem({ retailPrice: 15000, wholesalePrice: 12000 });
  await stockUp(item, "100", "10000");

  const retail = await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "1", unitPrice: "15000" }] },
    { userId }
  );
  assert.equal(decimalToString(retail.sale.lines[0].suggestedPrice), "15000");

  const wholesale = await recordSale(
    { paymentType: "cash", priceMode: "wholesale", lines: [{ itemId: item._id, qty: "1", unitPrice: "12000" }] },
    { userId }
  );
  assert.equal(decimalToString(wholesale.sale.lines[0].suggestedPrice), "12000");

  // No wholesale price set -> wholesale mode suggests retail (never 0).
  const noWholesale = await newItem({ name: "NoWS", retailPrice: 9000 });
  await stockUp(noWholesale, "100", "5000");
  const r = await recordSale(
    { paymentType: "cash", priceMode: "wholesale", lines: [{ itemId: noWholesale._id, qty: "1", unitPrice: "9000" }] },
    { userId }
  );
  assert.equal(decimalToString(r.sale.lines[0].suggestedPrice), "9000");
});

test("below-cost line is detectable (unitPrice < costAtTime) and still saves; price 0 allowed", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000"); // cost ₹100

  const { sale } = await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { itemId: item._id, qty: "5", unitPrice: "9000" }, // below cost
        { itemId: item._id, qty: "1", unitPrice: "0" }, // giveaway
      ],
    },
    { userId }
  );
  const l0 = sale.lines[0];
  const belowCost = Number(decimalToString(l0.unitPrice)) < Number(decimalToString(l0.costAtTime));
  assert.equal(belowCost, true);
  assert.equal(lineProfit(l0), -5000); // (9000-10000)*5 = -5000 (a loss)
  assert.equal(decimalToString(sale.lines[1].unitPrice), "0");
});

test("credit sale requires + increases customer balance; payment decreases; advance goes negative", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const customer = await Customer.create({ name: "Dealer", balance: "0", openingBalance: "0" });

  // credit without a customer is rejected
  await assert.rejects(
    () => recordSale({ paymentType: "credit", priceMode: "retail", lines: [{ itemId: item._id, qty: "1", unitPrice: "15000" }] }, { userId }),
    /credit sale requires a customer/
  );

  const { customer: afterSale } = await recordSale(
    { paymentType: "credit", customerId: customer._id, priceMode: "retail", lines: [{ itemId: item._id, qty: "10", unitPrice: "15000" }] },
    { userId }
  );
  assert.equal(decimalToString(afterSale.balance), "150000"); // owes 150000

  const { customer: afterPay } = await recordCustomerPayment({ customerId: customer._id, amount: "150000" }, { userId });
  assert.equal(decimalToString(afterPay.balance), "0");

  const { customer: advance } = await recordCustomerPayment({ customerId: customer._id, amount: "50000" }, { userId });
  assert.equal(decimalToString(advance.balance), "-50000"); // advance: shop owes them
});

test("negative-stock: sells through by default; rejected (with line aggregation) when disabled", async () => {
  const item = await newItem();
  await stockUp(item, "5", "10000"); // stock 5

  // default allowNegativeInventory = true -> sells through to negative
  await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "20", unitPrice: "15000" }] },
    { userId }
  );
  assert.equal(decimalToString((await fresh(item._id)).stockQty), "-15");

  // disable, restock to 5, then two lines summing 7 > 5 must be rejected (aggregation)
  await Settings.findOneAndUpdate({ _id: "global" }, { $set: { allowNegativeInventory: false } }, { upsert: true });
  const item2 = await newItem({ name: "Gated" });
  await stockUp(item2, "5", "10000");
  await assert.rejects(
    () =>
      recordSale(
        {
          paymentType: "cash",
          priceMode: "retail",
          lines: [
            { itemId: item2._id, qty: "3", unitPrice: "15000" },
            { itemId: item2._id, qty: "4", unitPrice: "15000" },
          ],
        },
        { userId }
      ),
    /not enough stock/
  );
  // nothing applied
  assert.equal(decimalToString((await fresh(item2._id)).stockQty), "5");
  // selling within stock is fine
  await recordSale(
    { paymentType: "cash", priceMode: "retail", lines: [{ itemId: item2._id, qty: "3", unitPrice: "15000" }] },
    { userId }
  );
  assert.equal(decimalToString((await fresh(item2._id)).stockQty), "2");
});

test("one transaction per sale — a mid-sale failure persists nothing", async () => {
  const a = await newItem({ name: "A" });
  const b = await newItem({ name: "B" });
  await stockUp(a, "100", "10000");
  await stockUp(b, "100", "10000");
  const aStock = decimalToString((await fresh(a._id)).stockQty);

  const m = mock.method(StockMovement, "create", () => { throw new Error("boom writing sale movements"); });
  try {
    await assert.rejects(
      () =>
        recordSale(
          {
            paymentType: "cash",
            priceMode: "retail",
            lines: [
              { itemId: a._id, qty: "5", unitPrice: "15000" },
              { itemId: b._id, qty: "5", unitPrice: "15000" },
            ],
          },
          { userId }
        ),
      /boom/
    );
  } finally {
    m.mock.restore();
  }

  assert.equal(await Sale.countDocuments({}), 0);
  assert.equal(await StockMovement.countDocuments({ type: "sale" }), 0);
  assert.equal(decimalToString((await fresh(a._id)).stockQty), aStock); // unchanged
});

test("selling an inactive item is rejected", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  await Item.findByIdAndUpdate(item._id, { isActive: false });
  await assert.rejects(
    () => recordSale({ paymentType: "cash", priceMode: "retail", lines: [{ itemId: item._id, qty: "1", unitPrice: "15000" }] }, { userId }),
    /inactive/
  );
});

test("duplicate item across lines: no merge; stock decrements sum; same cost snapshot per line", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000"); // avg ₹100, stock 100

  const { sale } = await recordSale(
    {
      paymentType: "cash",
      priceMode: "retail",
      lines: [
        { itemId: item._id, qty: "10", unitPrice: "15000" },
        { itemId: item._id, qty: "5", unitPrice: "16000" },
      ],
    },
    { userId }
  );

  assert.equal(sale.lines.length, 2); // not merged
  assert.equal(decimalToString(sale.lines[0].costAtTime), "10000");
  assert.equal(decimalToString(sale.lines[1].costAtTime), "10000"); // same avg, sale doesn't move it
  assert.equal(decimalToString(sale.total), "230000"); // 10*15000 + 5*16000
  assert.equal(decimalToString((await fresh(item._id)).stockQty), "85"); // 100 - 15 summed
  assert.equal(await StockMovement.countDocuments({ type: "sale", refId: sale._id }), 2);
});

test("getSale populates lines' items and customer", async () => {
  const item = await newItem();
  await stockUp(item, "100", "10000");
  const customer = await Customer.create({ name: "Walk-in Dealer", balance: "0", openingBalance: "0" });
  const { sale } = await recordSale(
    { paymentType: "credit", customerId: customer._id, priceMode: "retail", lines: [{ itemId: item._id, qty: "2", unitPrice: "15000" }] },
    { userId }
  );
  const full = await getSale(sale._id);
  assert.equal(full.customerId.name, "Walk-in Dealer");
  assert.equal(full.lines[0].itemId.name, "GM wire");
});
