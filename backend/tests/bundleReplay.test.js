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
import Supplier from "../src/models/Supplier.js";
import Settings from "../src/models/Settings.js";
import { createItem } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { recordSale } from "../src/services/saleService.js";
import { recomputeItemCostByReplay } from "../src/services/costService.js";
import { divide, multiply, round, HALF_EVEN, decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_bundle_replay?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(), Counter.init(),
    Customer.init(), Sale.init(), Purchase.init(), Supplier.init(), Settings.init(),
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
    Purchase.deleteMany({}), Supplier.deleteMany({}), Settings.deleteMany({}),
  ]);
  category = await Category.create({ name: "Wire", skuPrefix: "WIR" });
});

const newItem = async (over) => (await createItem(
  { name: "wire", categoryId: category._id, baseUnit: "gaz", retailPrice: 1100, ...over },
  { userId }
)).item;
const fresh = (id) => Item.findById(id).lean();
const avg = (it) => decimalToString(it.avgCost);
const stock = (it) => decimalToString(it.stockQty);

// THE SAFETY PROPERTY (spec 011 §6): a bundle purchase, after ÷90-at-purchase, must
// produce byte-identical canonical per-gaz state to the equivalent hand-entered per-gaz
// purchase — proving the conversion introduced ZERO drift in the cost engine.
test("bundle purchase === equivalent per-gaz purchase (stock, avgCost, weighted-avg, replay)", async () => {
  const B = await newItem({ bundle: true }); // bought by the 90-gaz bundle
  const C = await newItem({ bundle: false }); // control, plain gaz

  // First buy: B = 5 bundles @ Rs 900/bundle ; C = 450 gaz @ Rs 10.00/gaz. (paisa)
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: B._id, qty: "5", unitCost: "90000" }] }, { userId });
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: C._id, qty: "450", unitCost: "1000" }] }, { userId });

  let b = await fresh(B._id), c = await fresh(C._id);
  assert.equal(stock(b), "450");
  assert.equal(stock(b), stock(c));     // same stockQty in gaz
  assert.equal(avg(b), "1000");
  assert.equal(avg(b), avg(c));         // same per-gaz avgCost

  // Second buy at a different price: B = 3 bundles @ Rs 1080 ; C = 270 gaz @ Rs 12.00.
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: B._id, qty: "3", unitCost: "108000" }] }, { userId });
  await recordPurchase({ paymentType: "cash", lines: [{ itemId: C._id, qty: "270", unitCost: "1200" }] }, { userId });

  b = await fresh(B._id); c = await fresh(C._id);
  assert.equal(stock(b), "720");
  assert.equal(avg(b), "1075");         // weighted: (450*1000 + 270*1200)/720
  assert.equal(stock(b), stock(c));
  assert.equal(avg(b), avg(c));

  // A sale of the same gaz on each: equal costAtTime snapshot, equal profit, equal stock.
  const saleB = await recordSale({ paymentType: "cash", priceMode: "retail", lines: [{ itemId: B._id, qty: "100", unitPrice: "1500" }] }, { userId });
  const saleC = await recordSale({ paymentType: "cash", priceMode: "retail", lines: [{ itemId: C._id, qty: "100", unitPrice: "1500" }] }, { userId });
  const costB = decimalToString(saleB.sale.lines[0].costAtTime);
  const costC = decimalToString(saleC.sale.lines[0].costAtTime);
  assert.equal(costB, "1075");
  assert.equal(costB, costC);           // same costAtTime → same profit (same price & qty)
  assert.equal(stock(await fresh(B._id)), "620");
  assert.equal(stock(await fresh(B._id)), stock(await fresh(C._id)));

  // Replay from full movement history yields identical avgCost + stockQty for both.
  const rB = await recomputeItemCostByReplay(B._id);
  const rC = await recomputeItemCostByReplay(C._id);
  assert.equal(rB.avgCost, "1075");
  assert.equal(rB.stockQty, "620");
  assert.deepEqual(rB, rC);             // bundle item replays identically to the control
});

// A NON-clean-dividing bundle (Rs 950 ÷ 90 doesn't terminate) — there is no ≤2dp per-gaz
// control, so assert the precision + payable reconciliation directly (spec 011 §6).
test("non-clean bundle: exact Decimal per-gaz cost + exact payable, no leaked paisa", async () => {
  const B = await newItem({ bundle: true });
  const { purchase } = await recordPurchase(
    { paymentType: "cash", lines: [{ itemId: B._id, qty: "1", unitCost: "95000" }] }, // 1 bundle @ Rs 950
    { userId }
  );

  const b = await fresh(B._id);
  // (a) avgCost is the exact Decimal division at scale 10 — NOT rounded to whole paisa.
  assert.equal(avg(b), divide("95000", "90", 10, HALF_EVEN));
  assert.equal(stock(b), "90"); // 1 bundle = 90 gaz

  // (b) the supplier payable equals bundles × price-per-bundle EXACTLY — no leaked paisa.
  assert.equal(decimalToString(purchase.total), "95000");

  // (c) 90 × per-gaz cost reconciles back to the bundle price within the stored scale.
  assert.equal(round(multiply(avg(b), "90"), 0, HALF_EVEN), "95000");
});

// Opening stock declared in bundles converts to canonical gaz + per-gaz cost (ADR-013 path).
test("opening stock declared in bundles → canonical gaz + per-gaz cost", async () => {
  const B = await newItem({ bundle: true, openingQty: "2", openingUnitCost: "90000" }); // 2 bundles @ Rs 900
  const b = await fresh(B._id);
  assert.equal(stock(b), "180");  // 2 × 90 gaz
  assert.equal(avg(b), "1000");   // Rs 900/bundle ÷ 90 = Rs 10/gaz
});
