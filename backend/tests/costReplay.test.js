import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Supplier from "../src/models/Supplier.js";
import Purchase from "../src/models/Purchase.js";
import { createItem, adjustStock } from "../src/services/itemService.js";
import { recordPurchase } from "../src/services/purchaseService.js";
import { recomputeItemCostByReplay } from "../src/services/costService.js";
import { decimalToString } from "../src/lib/decimal.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_replay?replicaSet=rs0";

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

// Zero-stock item unless openingQty given.
async function newItem(openingQty) {
  const { item } = await createItem(
    {
      name: "GM wire",
      categoryId: category._id,
      baseUnit: "gaz",
      retailPrice: 15000,
      ...(openingQty != null ? { openingQty } : {}),
    },
    { userId }
  );
  return item;
}

const buy = (item, qty, unitCost) =>
  recordPurchase({ paymentType: "cash", lines: [{ itemId: item._id, qty, unitCost }] }, { userId });

// Insert a movement with an explicit createdAt (bypassing auto-timestamps), so
// ordering tests can shuffle insertion order independently of posting order.
async function rawMovement({ itemId, qty, type, costAtTime, createdAt, note }) {
  const doc = new StockMovement({ itemId, qty, type, costAtTime, note, createdBy: userId });
  if (createdAt) {
    doc.createdAt = createdAt;
    doc.updatedAt = createdAt;
    await doc.save({ timestamps: false });
  } else {
    await doc.save();
  }
  return doc;
}

const fresh = (id) => Item.findById(id);

// 1. Replay parity: replay reproduces exactly what the incremental engine stored.
test("replay parity: matches the incrementally-stored avgCost and stockQty", async () => {
  const item = await newItem();
  await buy(item, "100", "11000");
  await buy(item, "50", "12000");
  await buy(item, "25", "9000");

  const stored = await fresh(item._id);
  const replay = await recomputeItemCostByReplay(item._id);

  assert.equal(replay.avgCost, decimalToString(stored.avgCost));
  assert.equal(replay.stockQty, decimalToString(stored.stockQty));
});

// 2. Canonical: opening 200 (adjustment) + 100@₹110 -> ₹36.67; exclude the buy -> ₹0 / 200.
test("canonical ₹36.67: opening adjustment feeds the average; excluding the buy -> ₹0", async () => {
  const item = await newItem("200"); // opening stock as a type:"adjustment" movement
  const { purchase } = await buy(item, "100", "11000"); // ₹110.00

  const stored = await fresh(item._id);
  assert.equal(decimalToString(stored.avgCost), "3666.6666666667"); // ₹36.67
  assert.equal(decimalToString(stored.stockQty), "300");

  const full = await recomputeItemCostByReplay(item._id);
  assert.equal(full.avgCost, "3666.6666666667");
  assert.equal(full.stockQty, "300");

  // Reverse = exclude the purchase's movements -> only the 200@₹0 opening survives.
  const excluded = await recomputeItemCostByReplay(item._id, { excludeRefIds: [purchase._id] });
  assert.equal(excluded.avgCost, "0");
  assert.equal(excluded.stockQty, "200");
});

// 3. Mixed movements: purchase -> adjust(-60) -> purchase = ₹17.14, NOT the purchase-only ₹15.00.
test("mixed movements ₹17.14: a stock-out between purchases changes the average", async () => {
  const item = await newItem();
  await buy(item, "100", "1000"); // ₹10 -> avg 1000, stock 100
  await adjustStock({ itemId: item._id, countedQty: "40", note: "stock count" }, { userId }); // -60
  await buy(item, "100", "2000"); // ₹20 -> oldQty 40 -> (40*1000+100*2000)/140

  const stored = await fresh(item._id);
  assert.equal(decimalToString(stored.avgCost), "1714.2857142857"); // ₹17.14
  assert.equal(decimalToString(stored.stockQty), "140");

  const replay = await recomputeItemCostByReplay(item._id);
  assert.equal(replay.avgCost, "1714.2857142857");
  assert.equal(replay.stockQty, "140");
  assert.notEqual(replay.avgCost, "1500"); // the wrong purchase-only answer
});

// 4. Ordering: sort by (createdAt, _id) — independent of insertion order and of purchase.date.
test("ordering: replay sorts by (createdAt, _id), not insertion order", async () => {
  const item = await newItem();
  const t1 = new Date("2026-06-20T10:00:00Z");
  const t2 = new Date("2026-06-20T11:00:00Z");
  const t3 = new Date("2026-06-20T12:00:00Z");

  // Insert OUT OF ORDER (m3, m1, m2); posting order by createdAt is m1->m2->m3.
  await rawMovement({ itemId: item._id, qty: "100", type: "purchase", costAtTime: "3000", createdAt: t3 });
  await rawMovement({ itemId: item._id, qty: "100", type: "purchase", costAtTime: "1000", createdAt: t1 });
  await rawMovement({ itemId: item._id, qty: "-150", type: "sale", createdAt: t2 });

  // Posting order: +100@1000 (avg 1000) -> sale 150 (qty -50) -> +100@3000 (oldQty floored 0) = 3000.
  const replay = await recomputeItemCostByReplay(item._id);
  assert.equal(replay.avgCost, "3000");
  assert.equal(replay.stockQty, "50");

  // Same-createdAt tiebreak by _id: two same-item lines of ONE purchase (one bulk insert).
  const item2 = await newItem();
  await recordPurchase(
    {
      paymentType: "cash",
      lines: [
        { itemId: item2._id, qty: "100", unitCost: "11000" },
        { itemId: item2._id, qty: "50", unitCost: "12000" },
      ],
    },
    { userId }
  );
  const stored2 = await fresh(item2._id);
  const replay2 = await recomputeItemCostByReplay(item2._id);
  assert.equal(replay2.avgCost, decimalToString(stored2.avgCost)); // 11333.3333333333
  assert.equal(replay2.avgCost, "11333.3333333333");
});

// 5. Negative flooring: a stock-out to negative floors oldQty to 0 on the next purchase —
//    and replay reproduces exactly what the live engine (which also floored) stored.
test("negative running qty floors to 0 on the next purchase", async () => {
  const item = await newItem();
  await buy(item, "100", "5000"); // avg 5000, stock 100

  // Mirror a sale of 150 (drives stock to -50) at the ledger + cached-stock level.
  await rawMovement({ itemId: item._id, qty: "-150", type: "sale" });
  await Item.findByIdAndUpdate(item._id, { stockQty: Decimal128.fromString("-50") });

  await buy(item, "100", "9000"); // oldQty -50 -> floored 0 -> avg = 9000, stock = 50

  const stored = await fresh(item._id);
  assert.equal(decimalToString(stored.avgCost), "9000");
  assert.equal(decimalToString(stored.stockQty), "50");

  const replay = await recomputeItemCostByReplay(item._id);
  assert.equal(replay.avgCost, "9000");
  assert.equal(replay.stockQty, "50");
});

// 6. Drift detector: replay's recomputed stockQty equals the cached stockQty.
test("drift detector: recomputed stockQty equals cached stockQty after mixed ops", async () => {
  const item = await newItem("10");
  await buy(item, "100", "1000");
  await adjustStock({ itemId: item._id, countedQty: "90", note: "recount" }, { userId });
  await buy(item, "30", "2000");

  const stored = await fresh(item._id);
  const replay = await recomputeItemCostByReplay(item._id);
  assert.equal(replay.stockQty, decimalToString(stored.stockQty));
  assert.equal(replay.avgCost, decimalToString(stored.avgCost));
});

// 7. Guard: a purchase movement missing costAtTime makes replay throw (corruption surfaced).
test("guard: replay throws on a purchase movement missing costAtTime", async () => {
  const item = await newItem();
  await rawMovement({ itemId: item._id, qty: "100", type: "purchase" }); // no costAtTime

  await assert.rejects(
    () => recomputeItemCostByReplay(item._id),
    /missing costAtTime/
  );
});
