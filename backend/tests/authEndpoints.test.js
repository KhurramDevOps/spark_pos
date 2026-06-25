import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import Sale from "../src/models/Sale.js";
import Expense from "../src/models/Expense.js";
import { createUser } from "../src/services/authService.js";
import { migrateLegacyCreatedBy } from "../src/services/migrateCreatedBy.js";
import { SESSION_COOKIE_NAME } from "../src/middleware/session.js";
import { setHasUsers } from "../src/lib/setupState.js";
import { DEV_USER_ID } from "../src/middleware/currentUser.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_authep?replicaSet=rs0";

const PLACEHOLDER = new mongoose.Types.ObjectId(DEV_USER_ID);

async function hit(path, opts) {
  const res = await fetch(`${base}${path}`, opts);
  res._body = await res.text();
  return res;
}
const json = (res) => (res._body ? JSON.parse(res._body) : null);
const sparkCookie = (res) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? null;
const cookiePair = (sc) => (sc ? sc.split(";")[0] : null);
const sessions = () => mongoose.connection.collection("sessions");

const postJson = (path, body, headers = {}) =>
  hit(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

let server;
let base;

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
  await Promise.all([User.deleteMany({}), Sale.deleteMany({}), Expense.deleteMany({}), sessions().deleteMany({})]);
  setHasUsers(false); // default: fresh, un-bootstrapped DB
});

// --- bootstrap ------------------------------------------------------------

test("bootstrap on an empty DB creates the first owner, opens a session, and flips the gate open", async () => {
  // Before bootstrap, a normal route is 503 (gate).
  assert.equal((await hit("/api/items")).status, 503);

  const res = await postJson("/api/auth/bootstrap", { username: "owner", password: "password123" });
  assert.equal(res.status, 201);
  assert.ok(sparkCookie(res), "session cookie set on bootstrap");
  assert.equal(json(res).user.role, "owner");
  assert.equal(json(res).user.passwordHash, undefined); // never echoed

  const owner = await User.findOne({ username: "owner" });
  assert.equal(owner.role, "owner");
  assert.equal(owner.createdBy, null); // founding account

  // Gate is now open — the same route no longer 503s.
  assert.notEqual((await hit("/api/items")).status, 503);
});

test("bootstrap when an owner already exists returns 404 (route is functionally gone)", async () => {
  await createUser({ username: "owner", password: "password123", role: "owner" });
  setHasUsers(true);

  const res = await postJson("/api/auth/bootstrap", { username: "owner2", password: "password123" });
  assert.equal(res.status, 404);
});

// --- login ----------------------------------------------------------------

async function seedOwner() {
  await createUser({ username: "owner", password: "password123", role: "owner" });
  setHasUsers(true);
}

test("login success: 200, session cookie, lastLoginAt set, failedAttempts reset", async () => {
  await seedOwner();
  // One prior failure so we can prove the reset.
  await postJson("/api/auth/login", { username: "owner", password: "wrong" });
  assert.equal((await User.findOne({ username: "owner" })).failedAttempts, 1);

  const res = await postJson("/api/auth/login", { username: "owner", password: "password123" });
  assert.equal(res.status, 200);
  assert.ok(sparkCookie(res), "session cookie set");

  const owner = await User.findOne({ username: "owner" });
  assert.ok(owner.lastLoginAt instanceof Date);
  assert.equal(owner.failedAttempts, 0);
});

test("login wrong password: 401 generic message, failedAttempts incremented", async () => {
  await seedOwner();
  const res = await postJson("/api/auth/login", { username: "owner", password: "nope" });
  assert.equal(res.status, 401);
  assert.equal(json(res).error, "Invalid username or password");
  assert.equal((await User.findOne({ username: "owner" })).failedAttempts, 1);
});

test("login unknown username: 401 with the SAME generic message (no enumeration)", async () => {
  await seedOwner();
  const wrongPw = await postJson("/api/auth/login", { username: "owner", password: "nope" });
  const unknown = await postJson("/api/auth/login", { username: "ghost", password: "whatever1" });

  assert.equal(unknown.status, 401);
  assert.equal(json(unknown).error, json(wrongPw).error); // identical message
});

test("login on a locked account: 401 'too many attempts', password not even checked", async () => {
  await seedOwner();
  await User.updateOne(
    { username: "owner" },
    { $set: { failedAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } }
  );

  // Even the CORRECT password is rejected as locked.
  const res = await postJson("/api/auth/login", { username: "owner", password: "password123" });
  assert.equal(res.status, 401);
  assert.equal(json(res).error, "Too many failed attempts. Try again later.");
});

test("login on a deactivated account with the correct password: 401 inactive (distinct message)", async () => {
  await seedOwner();
  await User.updateOne({ username: "owner" }, { $set: { isActive: false } });

  const res = await postJson("/api/auth/login", { username: "owner", password: "password123" });
  assert.equal(res.status, 401);
  assert.equal(json(res).error, "Account is inactive.");
});

test("login lockout auto-expiry: with lockedUntil in the past, correct password succeeds", async () => {
  await seedOwner();
  await User.updateOne(
    { username: "owner" },
    { $set: { failedAttempts: 5, lockedUntil: new Date(Date.now() - 1000) } }
  );

  const res = await postJson("/api/auth/login", { username: "owner", password: "password123" });
  assert.equal(res.status, 200);
});

// --- logout ---------------------------------------------------------------

test("logout destroys the server-side session and clears the cookie", async () => {
  await seedOwner();
  const login = await postJson("/api/auth/login", { username: "owner", password: "password123" });
  const cookie = cookiePair(sparkCookie(login));
  assert.equal(await sessions().countDocuments(), 1);

  const logout = await postJson("/api/auth/logout", {}, { Cookie: cookie });
  assert.equal(logout.status, 200);
  // Client-side: cookie cleared.
  const cleared = logout.headers.getSetCookie().some(
    (c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(c)
  );
  assert.ok(cleared, "cookie cleared client-side");
  // Server-side: session gone (replay→401 through a guarded route is proven at
  // the requireAuth level in slice 3; re-asserted end-to-end in slice 7).
  assert.equal(await sessions().countDocuments(), 0, "session destroyed server-side");
});

// --- legacy createdBy migration (read carefully) --------------------------

test("bootstrap migrates legacy placeholder createdBy across the enumerated collections", async () => {
  // Two legacy records carrying the placeholder author id (raw inserts — they
  // represent pre-auth data), plus a control with a different author.
  const otherAuthor = new mongoose.Types.ObjectId();
  const legacySale = (await Sale.collection.insertOne({ createdBy: PLACEHOLDER, total: 1 })).insertedId;
  await Expense.collection.insertOne({ createdBy: PLACEHOLDER, category: "other" });
  const controlSale = (await Sale.collection.insertOne({ createdBy: otherAuthor, total: 2 })).insertedId;

  const res = await postJson("/api/auth/bootstrap", { username: "owner", password: "password123" });
  assert.equal(res.status, 201);
  const ownerId = json(res).user._id;
  assert.ok(json(res).migrated >= 2, "bootstrap reports the migration count");

  // The legacy Sale and Expense now point at the new owner; the control is untouched.
  assert.equal(String((await Sale.collection.findOne({ _id: legacySale })).createdBy), ownerId);
  assert.equal(String((await Sale.collection.findOne({ _id: controlSale })).createdBy), String(otherAuthor));
  const migratedExpense = await Expense.collection.findOne({});
  assert.equal(String(migratedExpense.createdBy), ownerId);
});

test("bootstrap is transactional: a migration failure rolls back the owner AND leaves bootstrap retryable", async () => {
  await Sale.collection.insertOne({ createdBy: PLACEHOLDER, total: 1 });

  // Force the migration to throw mid-way (after the owner is created inside the txn).
  const spy = mock.method(Sale, "updateMany", () => {
    throw new Error("simulated migration failure");
  });

  try {
    const failed = await postJson("/api/auth/bootstrap", { username: "owner", password: "password123" });
    assert.notEqual(failed.status, 201, "bootstrap did not succeed");
    // Owner-creation rolled back with the migration.
    assert.equal(await User.estimatedDocumentCount(), 0, "no half-created owner");
    // hasUsers was NOT flipped → bootstrap is still reachable (not 404), the route is still gated.
    assert.equal((await hit("/api/items")).status, 503, "gate still closed — clean retry possible");
  } finally {
    mock.restoreAll();
  }

  // Retry now succeeds and the migration completes.
  const ok = await postJson("/api/auth/bootstrap", { username: "owner", password: "password123" });
  assert.equal(ok.status, 201);
  assert.ok(json(ok).migrated >= 1);
  assert.equal(await User.estimatedDocumentCount(), 1);
});

test("migration is idempotent at the function level (second run is a no-op)", async () => {
  const owner = await createUser({ username: "owner", password: "password123", role: "owner" });
  await Sale.collection.insertOne({ createdBy: PLACEHOLDER, total: 1 });

  const first = await migrateLegacyCreatedBy(owner._id);
  assert.equal(first.total, 1);

  // Nothing left carrying the placeholder → second run matches nothing.
  const second = await migrateLegacyCreatedBy(owner._id);
  assert.equal(second.total, 0);
});
