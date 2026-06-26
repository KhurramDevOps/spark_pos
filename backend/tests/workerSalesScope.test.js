import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import Sale from "../src/models/Sale.js";
import { createUser } from "../src/services/authService.js";
import { SESSION_COOKIE_NAME } from "../src/middleware/session.js";
import { setHasUsers } from "../src/lib/setupState.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_scope?replicaSet=rs0";

async function hit(path, cookie) {
  const res = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  res._body = await res.text();
  return res;
}
const json = (res) => (res._body ? JSON.parse(res._body) : null);
const sparkCookie = (res) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? null;

const login = async (username) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password123" }),
  });
  return sparkCookie(res).split(";")[0];
};

let server;
let base;
let workerId;
let ownerId;
let workerSaleId;
let ownerSaleId;

before(async () => {
  await mongoose.connect(TEST_URI);
  await User.init();
  await new Promise((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Sale.deleteMany({}), mongoose.connection.collection("sessions").deleteMany({})]);
  const owner = await createUser({ username: "owner", password: "password123", role: "owner" });
  const worker = await createUser({ username: "worker", password: "password123", role: "worker" });
  ownerId = owner._id;
  workerId = worker._id;
  setHasUsers(true);

  // One sale by each author (inserted directly with a known createdBy — the
  // create path's createdBy=session-user is covered by saleHttp).
  const base0 = { date: new Date(), total: 100, paymentType: "cash", priceMode: "retail", lines: [] };
  ownerSaleId = (await Sale.collection.insertOne({ ...base0, createdBy: ownerId })).insertedId;
  workerSaleId = (await Sale.collection.insertOne({ ...base0, createdBy: workerId })).insertedId;
});

test("worker sees ONLY their own sales in the history list; owner sees all", async () => {
  const worker = await login("worker");
  const owner = await login("owner");

  const wList = json(await hit("/api/sales", worker));
  assert.equal(wList.sales.length, 1, "worker sees exactly one sale");
  assert.equal(String(wList.sales[0].createdBy), String(workerId), "and it's their own");

  const oList = json(await hit("/api/sales", owner));
  assert.equal(oList.sales.length, 2, "owner sees both sales");
});

test("public carve-outs resolve with no session on the real app (health 200, image route not auth/gate-blocked)", async () => {
  const health = await hit("/api/health"); // no cookie
  assert.equal(health.status, 200);

  const img = await hit("/api/static/items/nope.jpg"); // no cookie
  assert.notEqual(img.status, 401, "image bytes route is not auth-blocked");
  assert.notEqual(img.status, 503, "image bytes route is not setup-gated");
});

test("worker is 403 fetching another user's sale by id, 200 for their own", async () => {
  const worker = await login("worker");

  assert.equal((await hit(`/api/sales/${ownerSaleId}`, worker)).status, 403, "another user's sale → 403");
  assert.equal((await hit(`/api/sales/${workerSaleId}`, worker)).status, 200, "own sale → 200");

  // Owner can fetch either.
  const owner = await login("owner");
  assert.equal((await hit(`/api/sales/${ownerSaleId}`, owner)).status, 200);
  assert.equal((await hit(`/api/sales/${workerSaleId}`, owner)).status, 200);
});
