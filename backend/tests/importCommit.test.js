import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import ImportLog from "../src/models/ImportLog.js";
import { previewImport, commitImport } from "../src/services/importService.js";
import * as stash from "../src/lib/importStash.js";
import { HEADERS } from "../src/lib/csvImport.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_import_commit?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
const HEADER = HEADERS.join(",");
const csv = (...rows) => [HEADER, ...rows].join("\n");

// Preview to stash the file, then commit it (the real two-step flow).
async function previewThenCommit(text) {
  const { token } = await previewImport({ text, filename: "f.csv", createdBy: userId });
  return commitImport({ token, createdBy: userId });
}

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(),
    Category.init(),
    StockMovement.init(),
    Counter.init(),
    ImportLog.init(),
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
    ImportLog.deleteMany({}),
  ]);
  stash._clear();
});

test("commit imports valid rows, auto-generates SKUs, and writes the ImportLog", async () => {
  const res = await previewThenCommit(
    csv("GM wire,Wire,gaz,120,,,100,,,80", "Cable,Wire,gaz,150,,,,FOO-1")
  );

  assert.deepEqual(res.counts, { created: 2, skipped: 0, newCategories: 1 });
  assert.equal(await Item.countDocuments({}), 2);

  const auto = await Item.findOne({ name: "GM wire" });
  // SKU generated at commit (not preview); "Wire" -> deriveSkuPrefix -> "WIRE".
  assert.equal(auto.sku, "WIRE-0001");
  assert.equal(String(auto.stockQty), "100");

  const log = await ImportLog.findById(res.importLogId);
  assert.equal(log.counts.created, 2);
  assert.equal(log.errorReport.length, 0);
});

test("partial-commit rollback: a row failing after others landed writes NOTHING for itself", async () => {
  // Three rows, each with opening stock (so each would write a movement). Force
  // the *middle* row's movement insert to throw — its whole transaction must
  // roll back (no orphan item), while the rows around it stay committed.
  const text = csv(
    "A,Wire,gaz,120,,,10,,,80",
    "B,Wire,gaz,120,,,5,,,80", // this one will blow up
    "C,Wire,gaz,120,,,3,,,80"
  );
  const { token } = await previewImport({ text, createdBy: userId });

  const realCreate = StockMovement.create;
  const m = mock.method(StockMovement, "create", function (docs, opts) {
    if (Array.isArray(docs) && docs[0]?.qty === "5") throw new Error("boom on row B");
    return realCreate.call(StockMovement, docs, opts);
  });

  let res;
  try {
    res = await commitImport({ token, createdBy: userId });
  } finally {
    m.mock.restore();
  }

  // Good rows persisted; failed row left no trace.
  assert.equal(res.counts.created, 2);
  assert.equal(res.counts.skipped, 1);
  assert.equal(await Item.countDocuments({}), 2);
  assert.equal(await Item.countDocuments({ name: "B" }), 0, "failed item must not persist");

  // No item without its movement, and no movement without its item.
  assert.equal(await StockMovement.countDocuments({}), 2);
  for (const name of ["A", "C"]) {
    const it = await Item.findOne({ name });
    assert.ok(it);
    assert.equal(await StockMovement.countDocuments({ itemId: it._id }), 1);
  }

  // ImportLog counts match reality; error report = exactly the failed row.
  const log = await ImportLog.findOne({});
  assert.equal(log.counts.created, 2);
  assert.equal(log.counts.skipped, 1);
  assert.equal(res.errorReport.length, 1);
  assert.equal(res.errorReport[0].rowNumber, 3); // B is file line 3
  assert.equal(res.errorReport[0].name, "B");
  assert.match(res.errorReport[0]._error, /boom on row B/);
});

test("commit with an expired/missing token returns a re-upload message", async () => {
  await assert.rejects(
    () => commitImport({ token: "does-not-exist", createdBy: userId }),
    /re-upload/
  );
});

test("a category created up front is reused (not duplicated) across many rows", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => `Item ${i},Gadgets,piece,100,,,,`);
  const res = await previewThenCommit(csv(...rows));

  assert.equal(res.counts.created, 5);
  assert.equal(res.counts.newCategories, 1);
  assert.equal(await Category.countDocuments({ name: "Gadgets" }), 1);
  assert.equal(await Item.countDocuments({}), 5);

  // All five reference the same category.
  const cat = await Category.findOne({ name: "Gadgets" });
  assert.equal(await Item.countDocuments({ categoryId: cat._id }), 5);
});

test("commit skips validation-error rows and reports them too", async () => {
  const res = await previewThenCommit(
    csv("Good,Wire,gaz,120,,,,", "Bad,Wire,litre,120,,,,") // 2nd has invalid baseUnit
  );
  assert.equal(res.counts.created, 1);
  assert.equal(res.counts.skipped, 1);
  assert.equal(res.errorReport.length, 1);
  assert.match(res.errorReport[0]._error, /baseUnit/);
  assert.ok(res.errorReportCsv.includes("_error"));
});

test("commit consumes the token (a second commit fails)", async () => {
  const { token } = await previewImport({ text: csv("A,Wire,gaz,10,,,,"), createdBy: userId });
  await commitImport({ token, createdBy: userId });
  await assert.rejects(() => commitImport({ token, createdBy: userId }), /re-upload/);
});
