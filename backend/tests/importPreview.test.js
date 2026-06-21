import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import { createItem } from "../src/services/itemService.js";
import { previewImport } from "../src/services/importService.js";
import * as stash from "../src/lib/importStash.js";
import { HEADERS } from "../src/lib/csvImport.js";

// Transactions require a replica set; own DB per file (parallel test runner).
const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_import_preview?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();
const HEADER = HEADERS.join(",");
const csv = (...rows) => [HEADER, ...rows].join("\n");

before(async () => {
  await mongoose.connect(TEST_URI);
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
  stash._clear();
});

test("preview reports create/error counts and new categories accurately", async () => {
  await Category.create({ name: "Wire", skuPrefix: "WIR" });
  const text = csv(
    "GM wire,Wire,gaz,120,,,,", // create, existing category
    "Ceiling Fan,Fans,piece,8500,,,,", // create, NEW category "Fans"
    "Bad row,Misc,litre,100,,,," // error: bad baseUnit
  );

  const res = await previewImport({ text, filename: "f.csv", createdBy: userId });

  assert.equal(res.summary.total, 3);
  assert.equal(res.summary.toCreate, 2);
  assert.equal(res.summary.errors, 1);
  assert.equal(res.summary.newCategories, 1);
  assert.deepEqual(res.newCategories, ["Fans"]);
  assert.equal(res.rows.find((r) => r.rowNumber === 4).status, "error");
});

test("preview de-dupes new categories case-insensitively within the file", async () => {
  const text = csv(
    "A,Wire,gaz,10,,,,",
    "B,wire,gaz,10,,,,", // same category, different case
    "C,WIRE,gaz,10,,,," // and again
  );
  const res = await previewImport({ text, createdBy: userId });
  assert.equal(res.summary.newCategories, 1);
});

test("preview flags an existing DB SKU as an error (insert-only)", async () => {
  const cat = await Category.create({ name: "Wire", skuPrefix: "WIR" });
  await createItem({ name: "Existing", categoryId: cat._id, baseUnit: "gaz", retailPrice: 100, sku: "WIR-9" }, { userId });

  const text = csv("Dupe,Wire,gaz,120,,,,wir-9"); // case-insensitive collision
  const res = await previewImport({ text, createdBy: userId });

  assert.equal(res.summary.errors, 1);
  assert.match(res.rows[0].errors.join(" "), /already exists/);
});

test("preview catches an in-file duplicate SKU on the later row", async () => {
  const text = csv(
    "First,Wire,gaz,120,,,,ABC-1",
    "Second,Wire,gaz,120,,,,abc-1" // duplicate within file
  );
  const res = await previewImport({ text, createdBy: userId });
  assert.equal(res.rows[0].status, "create");
  assert.equal(res.rows[1].status, "error");
  assert.match(res.rows[1].errors.join(" "), /duplicated earlier/);
});

test("preview warns (not errors) on a duplicate name+category within the file", async () => {
  const text = csv(
    "GM wire,Wire,gaz,120,,,,",
    "GM wire,Wire,gaz,130,,,," // same name+category — warning only
  );
  const res = await previewImport({ text, createdBy: userId });
  assert.equal(res.summary.toCreate, 2);
  assert.equal(res.summary.errors, 0);
  assert.equal(res.rows[1].warnings.length, 1);
  assert.match(res.rows[1].warnings[0], /same name \+ category as row 2/);
});

test("preview NEVER burns the SKU counter (ADR-004)", async () => {
  await Category.create({ name: "Wire", skuPrefix: "WIR" });
  const before = await Counter.find({});
  assert.equal(before.length, 0);

  const text = csv(
    "A,Wire,gaz,10,,,,", // auto-SKU rows — must not advance the counter
    "B,Wire,gaz,10,,,,"
  );
  const res = await previewImport({ text, createdBy: userId });
  assert.equal(res.rows[0].sku, "(auto)");

  const after = await Counter.find({});
  assert.equal(after.length, 0, "no counter document should be created by a preview");
});

test("preview returns a token that stashes the upload for commit", async () => {
  const text = csv("A,Wire,gaz,10,,,,");
  const res = await previewImport({ text, createdBy: userId });
  assert.ok(res.token);
  assert.equal(stash.get(res.token).text, text);
});

test("preview rejects a file missing a required header", async () => {
  const text = "name,categoryName,baseUnit\nA,Wire,gaz"; // no retailPrice
  await assert.rejects(() => previewImport({ text, createdBy: userId }), /retailPrice/);
});

test("preview rejects an empty (header-only) file", async () => {
  await assert.rejects(() => previewImport({ text: HEADER, createdBy: userId }), /no data rows/);
});
