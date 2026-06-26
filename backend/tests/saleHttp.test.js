import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { setHasUsers } from "../src/lib/setupState.js";
import { createUser } from "../src/services/authService.js";

let authCookie = "";
import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import Customer from "../src/models/Customer.js";
import Sale from "../src/models/Sale.js";
import Purchase from "../src/models/Purchase.js";
import Settings from "../src/models/Settings.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_sale_http?replicaSet=rs0";

let server, base;
const api = (path, options = {}) =>
  fetch(`${base}${path}`, { ...options, headers: { ...(options.headers || {}), ...(authCookie ? { Cookie: authCookie } : {}) } });
const postJson = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let item;

before(async () => {
  await mongoose.connect(TEST_URI);
  setHasUsers(true); // spec 007: app now requires a bootstrapped owner; these route tests assume one exists
  await Promise.all([
    Item.init(), Category.init(), StockMovement.init(), Counter.init(),
    Customer.init(), Sale.init(), Purchase.init(), Settings.init(),
  ]);
  await new Promise((r) => (server = createApp().listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
  // Slice 7: log in as owner AFTER the server/base exist; send the cookie on every request.
  await createUser({ username: "owner", password: "password123", role: "owner" }).catch((e) => { if (e.status !== 409) throw e; });
  {
    const _login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "owner", password: "password123" }) });
    authCookie = _login.headers.getSetCookie().find((c) => c.startsWith("spark.sid="))?.split(";")[0] ?? "";
  }
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
    Purchase.deleteMany({}), Settings.deleteMany({}),
  ]);
  const cat = await Category.create({ name: "Wire", skuPrefix: "WIR" });
  // Stock + avgCost via a cash purchase over HTTP-independent setup: seed directly.
  item = await Item.create({
    sku: "WIR-1", name: "GM wire", categoryId: cat._id, baseUnit: "gaz",
    retailPrice: 15000, avgCost: "10000", stockQty: "100",
  });
});

test("cash sale over HTTP: rupees->paisa, stock drops, cost snapshot, avg unchanged", async () => {
  // unitPrice entered in RUPEES (150.50) -> 15050 paisa
  const res = await postJson("/sales", {
    paymentType: "cash",
    priceMode: "retail",
    lines: [{ itemId: String(item._id), qty: "10", unitPrice: "150.50" }],
  });
  assert.equal(res.status, 201);
  const { sale } = await res.json();
  assert.equal(sale.total.$numberDecimal, "150500"); // 10 * 15050
  assert.equal(sale.lines[0].costAtTime.$numberDecimal, "10000"); // avgCost snapshot
  assert.equal(sale.lines[0].suggestedPrice.$numberDecimal, "15000"); // retail

  const fresh = await Item.findById(item._id);
  assert.equal(String(fresh.stockQty), "90");
  assert.equal(String(fresh.avgCost), "10000"); // UNCHANGED by the sale
});

test("credit sale over HTTP increases customer khata; payment decreases it", async () => {
  const customer = await (await postJson("/customers", { name: "Dealer", openingBalance: "0" })).json();

  let res = await postJson("/sales", {
    paymentType: "credit",
    customerId: customer._id,
    priceMode: "retail",
    lines: [{ itemId: String(item._id), qty: "10", unitPrice: "150" }], // 10 * 15000 = 150000
  });
  assert.equal(res.status, 201);
  assert.equal(String((await Customer.findById(customer._id)).balance), "150000");

  res = await postJson(`/customers/${customer._id}/payments`, { amount: "1000" }); // Rs1000 = 100000
  assert.equal(res.status, 201);
  assert.equal(String((await Customer.findById(customer._id)).balance), "50000");
});

test("credit sale without a customer is rejected (400)", async () => {
  const res = await postJson("/sales", {
    paymentType: "credit",
    priceMode: "retail",
    lines: [{ itemId: String(item._id), qty: "1", unitPrice: "150" }],
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /requires a customer/);
});

test("negative-stock endpoint lists items below zero after a sell-through", async () => {
  // sell 120 of 100 -> stock -20 (allowNegativeInventory defaults true)
  await postJson("/sales", {
    paymentType: "cash", priceMode: "retail",
    lines: [{ itemId: String(item._id), qty: "120", unitPrice: "150" }],
  });
  const neg = await (await api("/items/negative-stock")).json();
  assert.equal(neg.length, 1);
  assert.equal(neg[0].sku, "WIR-1");
  assert.equal(String(neg[0].stockQty.$numberDecimal ?? neg[0].stockQty), "-20");
});

test("validation: qty 0 and >2dp price rejected (400)", async () => {
  assert.equal((await postJson("/sales", {
    paymentType: "cash", priceMode: "retail", lines: [{ itemId: String(item._id), qty: "0", unitPrice: "150" }],
  })).status, 400);
  assert.equal((await postJson("/sales", {
    paymentType: "cash", priceMode: "retail", lines: [{ itemId: String(item._id), qty: "1", unitPrice: "150.555" }],
  })).status, 400);
});
