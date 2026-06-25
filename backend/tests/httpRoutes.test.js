import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { setHasUsers } from "../src/lib/setupState.js";
import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_http?replicaSet=rs0";

let server;
let base;

const api = (path, options) => fetch(`${base}${path}`, options);
const postJson = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

before(async () => {
  await mongoose.connect(TEST_URI);
  setHasUsers(true); // spec 007: app now requires a bootstrapped owner; these route tests assume one exists
  await Promise.all([Item.init(), Category.init(), StockMovement.init(), Counter.init()]);
  // Bind to IPv4 loopback on an ephemeral port.
  await new Promise((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
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
});

test("full happy path over HTTP: category -> item(opening) -> adjust -> list", async () => {
  // create category
  let res = await postJson("/categories", { name: "Wire & Cable" });
  assert.equal(res.status, 201);
  const category = await res.json();
  assert.ok(category._id);
  assert.equal(category.skuPrefix, "WIRE");

  // create item with opening stock + declared cost (spec 006c — opening now
  // requires a unit cost; it writes a cost-bearing `opening` movement)
  res = await postJson("/items", {
    name: "GM 7/29 wire",
    categoryId: category._id,
    baseUnit: "gaz",
    retailPrice: 12000,
    openingQty: "2.5",
    openingUnitCost: "10000", // Rs 100
  });
  assert.equal(res.status, 201);
  const { item, openingMovement } = await res.json();
  assert.equal(item.sku, "WIRE-0001");
  assert.equal(item.stockQty.$numberDecimal, "2.5");
  assert.equal(item.avgCost.$numberDecimal, "10000");
  assert.ok(openingMovement);
  assert.equal(openingMovement.type, "opening");

  // adjust to absolute 7 -> delta +4.5
  res = await postJson(`/items/${item._id}/adjust`, {
    countedQty: "7",
    note: "physical count",
  });
  assert.equal(res.status, 200);
  const adj = await res.json();
  assert.equal(adj.changed, true);
  assert.equal(adj.delta, "4.5");
  assert.equal(adj.item.stockQty.$numberDecimal, "7");

  // list with search
  res = await api("/items?search=gm");
  const page = await res.json();
  assert.equal(page.total, 1);
  assert.equal(page.items[0].sku, "WIRE-0001");
});

test("validation errors return 400 with a message", async () => {
  const cat = await (await postJson("/categories", { name: "Misc" })).json();
  const res = await postJson("/items", {
    name: "bad",
    categoryId: cat._id,
    baseUnit: "gaz",
    retailPrice: 0, // must be > 0
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /retail price/i);
});

test("duplicate SKU over HTTP returns 409", async () => {
  const cat = await (await postJson("/categories", { name: "Fans" })).json();
  const make = () =>
    postJson("/items", {
      name: "Fan",
      categoryId: cat._id,
      baseUnit: "piece",
      retailPrice: 5000,
      sku: "FAN-1",
    });
  assert.equal((await make()).status, 201);
  assert.equal((await make()).status, 409);
});

test("deactivate then reactivate an item over HTTP", async () => {
  const cat = await (await postJson("/categories", { name: "Belts" })).json();
  const { item } = await (
    await postJson("/items", {
      name: "Belt",
      categoryId: cat._id,
      baseUnit: "piece",
      retailPrice: 3000,
    })
  ).json();

  let res = await postJson(`/items/${item._id}/deactivate`, {});
  assert.equal((await res.json()).isActive, false);

  // default list (active-only) excludes it
  let page = await (await api("/items")).json();
  assert.equal(page.total, 0);

  res = await postJson(`/items/${item._id}/reactivate`, {});
  assert.equal((await res.json()).isActive, true);
  page = await (await api("/items")).json();
  assert.equal(page.total, 1);
});

test("repair-opening-cost over HTTP corrects an item's avgCost (spec 006c)", async () => {
  const cat = await (await postJson("/categories", { name: "Repair Wire" })).json();
  // Declared with the wrong cost (Rs 100), then repaired to Rs 250.
  const { item } = await (
    await postJson("/items", {
      name: "Mislabelled coil",
      categoryId: cat._id,
      baseUnit: "coil",
      retailPrice: 30000,
      openingQty: "12",
      openingUnitCost: "10000", // Rs 100 — wrong
    })
  ).json();
  assert.equal(item.avgCost.$numberDecimal, "10000");

  const res = await postJson(`/items/${item._id}/repair-opening-cost`, {
    unitCost: "25000", // Rs 250 — the real cost
    qty: "12",
    note: "father confirmed Rs 250 each",
  });
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.changed, true);
  assert.equal(report.before.avgCost, "10000");
  assert.equal(report.after.avgCost, "25000");
  assert.equal(report.after.stockQty, "12");

  // Exactly one opening movement remains.
  assert.equal(await StockMovement.countDocuments({ itemId: item._id, type: "opening" }), 1);
});

test("repair-opening-cost rejects an empty note with 400", async () => {
  const cat = await (await postJson("/categories", { name: "NoteGuard" })).json();
  const { item } = await (
    await postJson("/items", {
      name: "Thing", categoryId: cat._id, baseUnit: "piece", retailPrice: 5000,
    })
  ).json();

  const res = await postJson(`/items/${item._id}/repair-opening-cost`, {
    unitCost: "25000",
    qty: "3",
    note: "   ",
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /note is required/i);
});

test("repair-opening-cost 404s for a missing item", async () => {
  const ghost = new mongoose.Types.ObjectId();
  const res = await postJson(`/items/${ghost}/repair-opening-cost`, {
    unitCost: "25000", qty: "1", note: "no such item",
  });
  assert.equal(res.status, 404);
});

test("GET /items/:id/opening returns the declared opening (spec 006c §9.5)", async () => {
  const cat = await (await postJson("/categories", { name: "OpeningRead" })).json();
  const { item } = await (
    await postJson("/items", {
      name: "Declared coil", categoryId: cat._id, baseUnit: "coil",
      retailPrice: 30000, openingQty: "8", openingUnitCost: "20000", // Rs 200
    })
  ).json();

  const res = await api(`/items/${item._id}/opening`);
  assert.equal(res.status, 200);
  const { opening } = await res.json();
  assert.equal(opening.qty, "8");
  assert.equal(opening.unitCost, "20000");
  assert.equal(opening.legacy, false);
});

test("GET /items/:id/opening surfaces a legacy adjustment shape as needing repair", async () => {
  const cat = await (await postJson("/categories", { name: "LegacyRead" })).json();
  const { item } = await (
    await postJson("/items", { name: "Old item", categoryId: cat._id, baseUnit: "piece", retailPrice: 5000 })
  ).json();
  // Simulate pre-006c data: a cost-less adjustment noted "opening stock".
  await StockMovement.create({
    itemId: item._id, qty: "15", type: "adjustment", note: "opening stock",
    createdBy: new mongoose.Types.ObjectId(),
  });

  const { opening } = await (await api(`/items/${item._id}/opening`)).json();
  assert.equal(opening.qty, "15");
  assert.equal(opening.unitCost, null);
  assert.equal(opening.legacy, true);
});

test("GET /items/:id/opening returns null when no opening was declared", async () => {
  const cat = await (await postJson("/categories", { name: "NoOpening" })).json();
  const { item } = await (
    await postJson("/items", { name: "Plain", categoryId: cat._id, baseUnit: "piece", retailPrice: 5000 })
  ).json();
  const { opening } = await (await api(`/items/${item._id}/opening`)).json();
  assert.equal(opening, null);
});
