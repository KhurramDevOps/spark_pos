import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import { createItem, adjustStock } from "../src/services/itemService.js";
import { decimalToString } from "../src/lib/decimal.js";

// Transactions require a replica set. Local dev runs a single-node set "rs0"
// (see backend/README.md). Override with TEST_MONGODB_URI if needed.
// Own DB per test file: node --test runs files in parallel, so a shared DB
// would let one file's cleanup clobber another's data.
const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_items?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
let category;

before(async () => {
  await mongoose.connect(TEST_URI);
  // Ensure the unique SKU / name indexes are built before the tests rely on them.
  await Promise.all([Item.init(), Category.init(), StockMovement.init(), Counter.init()]);
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
  ]);
  category = await Category.create({ name: "Wire", skuPrefix: "WIR" });
});

const baseItem = () => ({
  name: "GM 7/29 wire",
  categoryId: category._id,
  baseUnit: "gaz",
  retailPrice: 12000, // paisa
});

test("auto-generates sequential per-prefix SKUs", async () => {
  const a = await createItem(baseItem(), { userId });
  const b = await createItem(baseItem(), { userId });
  assert.equal(a.item.sku, "WIR-0001");
  assert.equal(b.item.sku, "WIR-0002");
});

test("opening stock writes a paired movement in one transaction", async () => {
  const { item, openingMovement } = await createItem(
    { ...baseItem(), openingQty: "2.5" },
    { userId }
  );

  assert.equal(decimalToString(item.stockQty), "2.5");
  assert.ok(openingMovement);

  const movements = await StockMovement.find({ itemId: item._id });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type, "adjustment");
  assert.equal(movements[0].note, "opening stock");
  assert.equal(decimalToString(movements[0].qty), "2.5");
  assert.equal(String(movements[0].createdBy), String(userId));
});

test("zero opening stock writes no movement", async () => {
  const { item, openingMovement } = await createItem(
    { ...baseItem(), openingQty: "0" },
    { userId }
  );
  assert.equal(openingMovement, null);
  assert.equal(await StockMovement.countDocuments({ itemId: item._id }), 0);
});

test("adjustStock sets the absolute count and records the delta", async () => {
  const { item } = await createItem({ ...baseItem(), openingQty: "10" }, { userId });

  const res = await adjustStock(
    { itemId: item._id, countedQty: "7", note: "physical count" },
    { userId }
  );

  assert.equal(res.changed, true);
  assert.equal(res.delta, "-3");
  assert.equal(decimalToString(res.item.stockQty), "7");

  const movements = await StockMovement.find({ itemId: item._id }).sort({ createdAt: 1 });
  assert.equal(movements.length, 2); // opening + adjustment
  assert.equal(decimalToString(movements[1].qty), "-3");
});

test("fractional adjustment delta is exact", async () => {
  const { item } = await createItem({ ...baseItem(), openingQty: "2.5" }, { userId });
  const res = await adjustStock(
    { itemId: item._id, countedQty: "1.25", note: "recount" },
    { userId }
  );
  assert.equal(res.delta, "-1.25");
  assert.equal(decimalToString(res.item.stockQty), "1.25");
});

test("zero-delta adjustment is a no-op (no movement written)", async () => {
  const { item } = await createItem({ ...baseItem(), openingQty: "5" }, { userId });
  const before = await StockMovement.countDocuments({ itemId: item._id });

  const res = await adjustStock(
    { itemId: item._id, countedQty: "5", note: "no change" },
    { userId }
  );

  assert.equal(res.changed, false);
  assert.equal(res.delta, "0");
  assert.equal(await StockMovement.countDocuments({ itemId: item._id }), before);
});

test("duplicate SKU is rejected case-insensitively", async () => {
  await createItem({ ...baseItem(), sku: "ABC-1" }, { userId });
  await assert.rejects(
    () => createItem({ ...baseItem(), sku: "abc-1" }, { userId }),
    /already exists/
  );
});

test("invalid / negative quantities are rejected, never coerced", async () => {
  const { item } = await createItem({ ...baseItem(), openingQty: "1" }, { userId });
  await assert.rejects(
    () => adjustStock({ itemId: item._id, countedQty: "-1", note: "x" }, { userId }),
    /cannot be negative/
  );
  await assert.rejects(
    () => adjustStock({ itemId: item._id, countedQty: "abc", note: "x" }, { userId }),
    /not a valid decimal/
  );
});

test("adjustment requires a reason note", async () => {
  const { item } = await createItem({ ...baseItem(), openingQty: "1" }, { userId });
  await assert.rejects(
    () => adjustStock({ itemId: item._id, countedQty: "2", note: "  " }, { userId }),
    /note is required/
  );
});

test("transaction rolls back the item if the paired movement fails (atomicity)", async () => {
  // Force the opening-movement insert to throw; the item insert must roll back too.
  const m = mock.method(StockMovement, "create", () => {
    throw new Error("boom");
  });
  try {
    await assert.rejects(
      () => createItem({ ...baseItem(), openingQty: "5" }, { userId }),
      /boom/
    );
  } finally {
    m.mock.restore();
  }
  assert.equal(await Item.countDocuments({}), 0, "item should not persist");
});
