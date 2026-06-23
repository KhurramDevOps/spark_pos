import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import StockMovement from "../src/models/StockMovement.js";
import { recomputeItemCostByReplay } from "../src/services/costService.js";

// Slice 1 (spec 006c): the load-bearing costService change — `opening` is a
// cost-bearing replay event, treated identically to `purchase`. Pure replay over
// StockMovements; no Item/Category needed. Money is paisa (Rs 200 = 20000).

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_opening_replay?replicaSet=rs0";

const { ObjectId } = mongoose.Types;
const userId = new ObjectId();

before(async () => {
  await mongoose.connect(TEST_URI);
  await StockMovement.init();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await StockMovement.deleteMany({});
});

let clock = 0;
// Insert a movement with a monotonically increasing createdAt so posting order
// follows insertion order unless an explicit createdAt is given.
async function mv({ itemId, qty, type, costAtTime, refId, reversalRef, createdAt, note }) {
  const doc = new StockMovement({ itemId, qty, type, costAtTime, refId, reversalRef, note, createdBy: userId });
  doc.createdAt = createdAt ?? new Date(Date.UTC(2026, 0, 1) + clock++ * 1000);
  doc.updatedAt = doc.createdAt;
  await doc.save({ timestamps: false });
  return doc;
}

test("opening-only: avgCost = the opening's costAtTime exactly", async () => {
  const itemId = new ObjectId();
  await mv({ itemId, qty: "15", type: "opening", costAtTime: "20000" }); // Rs 200

  const r = await recomputeItemCostByReplay(itemId);
  assert.equal(r.avgCost, "20000");
  assert.equal(r.stockQty, "15");
});

test("opening + purchase weighted-average: 15@200 + 5@300 → 225, stock 20", async () => {
  const itemId = new ObjectId();
  await mv({ itemId, qty: "15", type: "opening", costAtTime: "20000" }); // Rs 200
  await mv({ itemId, qty: "5", type: "purchase", costAtTime: "30000" }); // Rs 300

  const r = await recomputeItemCostByReplay(itemId);
  // (15*20000 + 5*30000) / 20 = 450000 / 20 = 22500
  assert.equal(r.avgCost, "22500");
  assert.equal(r.stockQty, "20");
});

test("opening + reverse-purchase: excluding the purchase leaves the opening, avg = 200, stock 15", async () => {
  const itemId = new ObjectId();
  const purchaseId = new ObjectId();
  await mv({ itemId, qty: "15", type: "opening", costAtTime: "20000" }); // Rs 200
  await mv({ itemId, qty: "5", type: "purchase", costAtTime: "30000", refId: purchaseId });

  // Reverse = exclude that purchase's rows. Only the opening survives.
  const r = await recomputeItemCostByReplay(itemId, { excludeRefIds: [purchaseId] });
  assert.equal(r.avgCost, "20000");
  assert.equal(r.stockQty, "15");
});

test("opening also composes via the self-describing reversalRef exclusion", async () => {
  const itemId = new ObjectId();
  const purchaseId = new ObjectId();
  await mv({ itemId, qty: "15", type: "opening", costAtTime: "20000" });
  await mv({ itemId, qty: "5", type: "purchase", costAtTime: "30000", refId: purchaseId });
  // a reversing row that points back at the purchase → engine drops both
  await mv({ itemId, qty: "-5", type: "reversal", reversalRef: purchaseId });

  const r = await recomputeItemCostByReplay(itemId); // no explicit exclude — derived from reversalRef
  assert.equal(r.avgCost, "20000");
  assert.equal(r.stockQty, "15");
});

test("guard: an opening movement missing costAtTime makes replay throw", async () => {
  const itemId = new ObjectId();
  await mv({ itemId, qty: "15", type: "opening" }); // no costAtTime

  await assert.rejects(() => recomputeItemCostByReplay(itemId), /opening movement .* is missing costAtTime/);
});

test("guard: an opening movement with negative costAtTime makes replay throw", async () => {
  const itemId = new ObjectId();
  await mv({ itemId, qty: "15", type: "opening", costAtTime: "-100" });

  await assert.rejects(() => recomputeItemCostByReplay(itemId), /negative costAtTime/);
});
