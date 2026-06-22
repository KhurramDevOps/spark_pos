import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Customer from "../src/models/Customer.js";
import Sale from "../src/models/Sale.js";
import Purchase from "../src/models/Purchase.js";
import Settings from "../src/models/Settings.js";
import CustomerReturn from "../src/models/CustomerReturn.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_salevoid_http?replicaSet=rs0";

let server, base;
const api = (path, options) => fetch(`${base}${path}`, options);
const postJson = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

let item;

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(), Counter.init(),
    Customer.init(), Sale.init(), Purchase.init(), Settings.init(), CustomerReturn.init(),
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
    Category.deleteMany({}), Customer.deleteMany({}), Sale.deleteMany({}),
    Purchase.deleteMany({}), Settings.deleteMany({}), CustomerReturn.deleteMany({}),
  ]);
  const cat = await Category.create({ name: "Wire", skuPrefix: "WIR" });
  item = await Item.create({ sku: "WIR-1", name: "GM wire", categoryId: cat._id, baseUnit: "gaz", retailPrice: 15000, avgCost: "10000", stockQty: "100" });
});

const sell = (body) => postJson("/sales", { priceMode: "retail", ...body });

test("void over HTTP restores stock and marks the sale voided", async () => {
  const { sale } = await (await sell({ paymentType: "cash", lines: [{ itemId: String(item._id), qty: "10", unitPrice: "150" }] })).json();
  assert.equal(String((await Item.findById(item._id)).stockQty), "90");

  const res = await postJson(`/sales/${sale._id}/void`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).sale.voided, true);
  assert.equal(String((await Item.findById(item._id)).stockQty), "100");
});

test("customer return over HTTP: cash refund adds stock; returns list reflects it", async () => {
  const { sale } = await (await sell({ paymentType: "cash", lines: [{ itemId: String(item._id), qty: "10", unitPrice: "150" }] })).json();
  const res = await postJson(`/sales/${sale._id}/returns`, { lines: [{ itemId: String(item._id), qty: "3" }], refundMethod: "cash" });
  assert.equal(res.status, 201);
  assert.equal(String((await Item.findById(item._id)).stockQty), "93");

  const list = await (await api(`/sales/${sale._id}/returns`)).json();
  assert.equal(list.length, 1);
  assert.equal(String(list[0].total.$numberDecimal ?? list[0].total), "45000");
});

test("over-return is rejected (400) via the cumulative cap", async () => {
  const { sale } = await (await sell({ paymentType: "cash", lines: [{ itemId: String(item._id), qty: "5", unitPrice: "150" }] })).json();
  const res = await postJson(`/sales/${sale._id}/returns`, { lines: [{ itemId: String(item._id), qty: "6" }], refundMethod: "cash" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /more than was sold/);
});

test("double void is rejected (400)", async () => {
  const { sale } = await (await sell({ paymentType: "cash", lines: [{ itemId: String(item._id), qty: "1", unitPrice: "150" }] })).json();
  await postJson(`/sales/${sale._id}/void`);
  const res = await postJson(`/sales/${sale._id}/void`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /already voided/);
});
