import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { setHasUsers } from "../src/lib/setupState.js";
import { createUser } from "../src/services/authService.js";

let authCookie = "";
import { requireOwner } from "../src/middleware/requireOwner.js";
import Sale from "../src/models/Sale.js";
import Expense from "../src/models/Expense.js";
import Customer from "../src/models/Customer.js";
import Item from "../src/models/Item.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_reports_http?replicaSet=rs0";

const { ObjectId } = mongoose.Types;
const userId = new ObjectId();
let server, base;
const api = (path, options = {}) =>
  fetch(`${base}${path}`, { ...options, headers: { ...(options.headers || {}), ...(authCookie ? { Cookie: authCookie } : {}) } });

before(async () => {
  await mongoose.connect(TEST_URI);
  setHasUsers(true); // spec 007: app now requires a bootstrapped owner; these route tests assume one exists
  await Promise.all([Sale.init(), Expense.init(), Customer.init(), Item.init()]);
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
  await Promise.all([Sale.deleteMany({}), Expense.deleteMany({}), Customer.deleteMany({}), Item.deleteMany({})]);
});

test("GET /reports?window=this_month returns the full single-payload shape (200)", async () => {
  const item = await Item.create({
    name: "Fan", sku: "F1", categoryId: new ObjectId(), baseUnit: "piece",
    retailPrice: 150, wholesalePrice: 120, avgCost: "100", stockQty: "5",
  });
  await Sale.create({
    date: new Date(), paymentType: "cash", priceMode: "retail",
    lines: [{ itemId: item._id, qty: "2", unitPrice: "150", suggestedPrice: "150", costAtTime: "100", lineTotal: "300" }],
    total: "300", createdBy: userId,
  });
  await Expense.create({ date: new Date(), category: "salary", amount: "500", createdBy: userId });
  await Customer.create({ name: "Owes", balance: "1000" });

  const res = await api("/reports?window=this_month");
  assert.equal(res.status, 200);
  const body = await res.json();

  // shape: every section present
  for (const k of ["window", "headline", "trend", "items", "deadStock", "expenseBreakdown", "khata"]) {
    assert.ok(k in body, `missing ${k}`);
  }
  for (const k of ["revenue", "grossProfit", "expenses", "net"]) {
    assert.ok("value" in body.headline[k] && "delta" in body.headline[k], `headline.${k} malformed`);
  }
  // a couple of real numbers (this month has the seeded data)
  assert.equal(body.headline.revenue.value, "300");
  assert.equal(body.headline.grossProfit.value, "100"); // 2 * (150-100)
  assert.equal(body.headline.expenses.value, "500");
  assert.equal(body.headline.net.value, "-400");
  assert.equal(body.khata.customers.owed[0].name, "Owes");
});

test("GET /reports validation: bad/missing window and bad custom are 400", async () => {
  assert.equal((await api("/reports")).status, 400); // missing window
  assert.equal((await api("/reports?window=decade")).status, 400); // unknown
  assert.equal((await api("/reports?window=custom")).status, 400); // custom without dates
  assert.equal((await api("/reports?window=custom&start=2026-06-10&end=2026-06-09")).status, 400); // start>end
  const future = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
  assert.equal((await api(`/reports?window=custom&start=${future}&end=${future}`)).status, 400); // future
});

test("GET /reports?window=custom with a valid range is 200", async () => {
  const res = await api("/reports?window=custom&start=2024-01-01&end=2024-01-31");
  assert.equal(res.status, 200);
});

test("requireOwner gate blocks a non-owner (403)", () => {
  let status;
  const res = { status: (s) => ((status = s), res) };
  let err;
  requireOwner({ userRole: "worker" }, res, (e) => (err = e));
  assert.equal(status, 403);
  assert.match(err.message, /owner/);
});
