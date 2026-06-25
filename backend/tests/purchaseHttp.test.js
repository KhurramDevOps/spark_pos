import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { setHasUsers } from "../src/lib/setupState.js";
import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Supplier from "../src/models/Supplier.js";
import Purchase from "../src/models/Purchase.js";
import SupplierPayment from "../src/models/SupplierPayment.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_purchase_http?replicaSet=rs0";

let server, base;
const api = (path, options) => fetch(`${base}${path}`, options);
const postJson = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let item;

before(async () => {
  await mongoose.connect(TEST_URI);
  setHasUsers(true); // spec 007: app now requires a bootstrapped owner; these route tests assume one exists
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(), Counter.init(),
    Supplier.init(), Purchase.init(), SupplierPayment.init(),
  ]);
  await new Promise((r) => (server = createApp().listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    Item.deleteMany({}), StockMovement.deleteMany({}), Counter.deleteMany({}),
    Category.deleteMany({}), Supplier.deleteMany({}), Purchase.deleteMany({}),
    SupplierPayment.deleteMany({}),
  ]);
  const cat = await Category.create({ name: "Wire", skuPrefix: "WIR" });
  item = (await Item.create({ sku: "WIR-1", name: "GM wire", categoryId: cat._id, baseUnit: "gaz", retailPrice: 15000 }));
});

test("cash purchase over HTTP: rupees->paisa, stock + avgCost update", async () => {
  // unitCost entered in RUPEES (110.50) -> 11050 paisa
  const res = await postJson("/purchases", {
    paymentType: "cash",
    lines: [{ itemId: String(item._id), qty: "100", unitCost: "110.50" }],
  });
  assert.equal(res.status, 201);
  const { purchase } = await res.json();
  assert.equal(purchase.total.$numberDecimal, "1105000"); // 100 * 11050 paisa

  const fresh = await Item.findById(item._id);
  assert.equal(String(fresh.avgCost), "11050");
  assert.equal(String(fresh.stockQty), "100");
});

test("credit purchase increases supplier balance; payment decreases it", async () => {
  const supplier = await (await postJson("/suppliers", { name: "Acme", openingBalance: "0" })).json();

  let res = await postJson("/purchases", {
    paymentType: "credit",
    supplierId: supplier._id,
    lines: [{ itemId: String(item._id), qty: "10", unitCost: "500" }], // 10 * 50000 = 500000 paisa
  });
  assert.equal(res.status, 201);
  assert.equal(String((await Supplier.findById(supplier._id)).balance), "500000");

  // Pay Rs 2000 (200000 paisa) -> balance 300000
  res = await postJson(`/suppliers/${supplier._id}/payments`, { amount: "2000" });
  assert.equal(res.status, 201);
  assert.equal(String((await Supplier.findById(supplier._id)).balance), "300000");
});

test("credit purchase without a supplier is rejected (400)", async () => {
  const res = await postJson("/purchases", {
    paymentType: "credit",
    lines: [{ itemId: String(item._id), qty: "1", unitCost: "100" }],
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /requires a supplier/);
});

test("validation: qty 0, >2dp cost, and empty lines are rejected", async () => {
  assert.equal((await postJson("/purchases", {
    paymentType: "cash", lines: [{ itemId: String(item._id), qty: "0", unitCost: "100" }],
  })).status, 400);

  assert.equal((await postJson("/purchases", {
    paymentType: "cash", lines: [{ itemId: String(item._id), qty: "1", unitCost: "100.555" }],
  })).status, 400);

  assert.equal((await postJson("/purchases", { paymentType: "cash", lines: [] })).status, 400);
});

test("supplier balance may go negative (advance) and is not blocked", async () => {
  const supplier = await (await postJson("/suppliers", { name: "Beta", openingBalance: "0" })).json();
  const res = await postJson(`/suppliers/${supplier._id}/payments`, { amount: "1000" }); // overpay
  assert.equal(res.status, 201);
  assert.equal(String((await Supplier.findById(supplier._id)).balance), "-100000");
});

test("purchase list filters by supplier", async () => {
  const s1 = await (await postJson("/suppliers", { name: "S1" })).json();
  await postJson("/purchases", { paymentType: "credit", supplierId: s1._id, lines: [{ itemId: String(item._id), qty: "1", unitCost: "100" }] });
  await postJson("/purchases", { paymentType: "cash", lines: [{ itemId: String(item._id), qty: "1", unitCost: "100" }] });

  const all = await (await api("/purchases")).json();
  assert.equal(all.total, 2);
  const filtered = await (await api(`/purchases?supplierId=${s1._id}`)).json();
  assert.equal(filtered.total, 1);
});
