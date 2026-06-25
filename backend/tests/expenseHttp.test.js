import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { setHasUsers } from "../src/lib/setupState.js";
import Expense from "../src/models/Expense.js";
import DrawerAdjustment from "../src/models/DrawerAdjustment.js";
import DayClose from "../src/models/DayClose.js";
import Sale from "../src/models/Sale.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_expense_http?replicaSet=rs0";

let server, base;
const api = (path, options) => fetch(`${base}${path}`, options);
const postJson = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  await mongoose.connect(TEST_URI);
  setHasUsers(true); // spec 007: app now requires a bootstrapped owner; these route tests assume one exists
  await Promise.all([Expense.init(), DrawerAdjustment.init(), DayClose.init(), Sale.init()]);
  await new Promise((r) => (server = createApp().listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([Expense.deleteMany({}), DrawerAdjustment.deleteMany({}), DayClose.deleteMany({}), Sale.deleteMany({})]);
});

test("expense over HTTP: rupees -> paisa, persists", async () => {
  const res = await postJson("/expenses", { category: "salary", amount: "15000" }); // Rs15,000
  assert.equal(res.status, 201);
  const e = await res.json();
  assert.equal(String(e.amount.$numberDecimal ?? e.amount), "1500000"); // paisa
  assert.equal(e.category, "salary");
});

test("expense validation: future date + bad category rejected (400)", async () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await postJson("/expenses", { category: "other", amount: "10", date: future })).status, 400);
  assert.equal((await postJson("/expenses", { category: "rent", amount: "10" })).status, 400);
});

test("drawer adjustment + daily close round-trip over HTTP", async () => {
  await postJson("/drawer-adjustments", { direction: "in", amount: "5000" }); // +500000 paisa
  await postJson("/expenses", { category: "electricity", amount: "1000" }); // -100000 paisa

  // today's close: expected = 0 + 0 + 0 + 500000 − 0 − 0 − 100000 − 0 = 400000
  const view = await (await api("/daily-close")).json();
  assert.equal(view.drawerIn, "500000");
  assert.equal(view.expenses, "100000");
  assert.equal(view.expectedCash, "400000");

  // save the close for today's Karachi date, then re-fetch shows it
  const today = view.date; // Karachi day start instant
  const ymd = new Date(today.valueOf?.() ?? today);
  const dateStr = new Date(ymd.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10); // back to Karachi Y-M-D
  const saved = await postJson("/daily-close", { date: dateStr, actualCash: "3500" }); // Rs3,500 counted
  assert.equal(saved.status, 200);
  assert.equal(await DayClose.countDocuments({}), 1);
});
