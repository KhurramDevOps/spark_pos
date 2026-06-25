import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import { createUser } from "../src/services/authService.js";
import { SESSION_COOKIE_NAME } from "../src/middleware/session.js";
import { setHasUsers } from "../src/lib/setupState.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_usermgmt?replicaSet=rs0";

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

const login = async (username, password = "password123") =>
  cookiePair(sparkCookie(await postJson("/api/auth/login", { username, password })));

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
  await Promise.all([User.deleteMany({}), sessions().deleteMany({})]);
  setHasUsers(true);
});

// --- guard: workers are forbidden -----------------------------------------

test("a worker session is 403 on every user-management endpoint", async () => {
  const owner = await createUser({ username: "owner", password: "password123", role: "owner" });
  await createUser({ username: "worker", password: "password123", role: "worker" });
  const w = await login("worker");

  assert.equal((await hit("/api/users", { headers: { Cookie: w } })).status, 403);
  assert.equal((await postJson("/api/users", { username: "x1", password: "password123" }, { Cookie: w })).status, 403);
  assert.equal((await postJson(`/api/users/${owner._id}/deactivate`, {}, { Cookie: w })).status, 403);
  assert.equal((await postJson(`/api/users/${owner._id}/reset-password`, { newPassword: "whatever1" }, { Cookie: w })).status, 403);
});

// --- create worker --------------------------------------------------------

test("owner creates a worker: 201, role worker, safe fields only, and the worker can log in", async () => {
  await createUser({ username: "owner", password: "password123", role: "owner" });
  const o = await login("owner");

  const res = await postJson("/api/users", { username: "ali", password: "password123" }, { Cookie: o });
  assert.equal(res.status, 201);
  assert.equal(json(res).user.role, "worker");
  assert.equal(json(res).user.passwordHash, undefined);

  assert.equal((await postJson("/api/auth/login", { username: "ali", password: "password123" })).status, 200);
});

test("PRIVILEGE GUARD: role:'owner' in the create-worker body is ignored — created as worker, not a second owner", async () => {
  await createUser({ username: "owner", password: "password123", role: "owner" });
  const o = await login("owner");

  const res = await postJson("/api/users", { username: "sneaky", password: "password123", role: "owner" }, { Cookie: o });
  assert.equal(res.status, 201);
  assert.equal(json(res).user.role, "worker", "forced to worker");
  assert.equal(await User.countDocuments({ role: "owner" }), 1, "still exactly one owner");
});

// --- self-protection ------------------------------------------------------

test("self-protection: with two owners, an owner cannot deactivate their OWN account", async () => {
  const a = await createUser({ username: "owner", password: "password123", role: "owner" });
  await createUser({ username: "owner2", password: "password123", role: "owner" });
  const o = await login("owner");

  const res = await postJson(`/api/users/${a._id}/deactivate`, {}, { Cookie: o });
  assert.equal(res.status, 400);
  assert.equal(json(res).error, "you cannot deactivate your own account");
});

test("self-protection: the last active owner cannot be deactivated", async () => {
  const a = await createUser({ username: "owner", password: "password123", role: "owner" });
  const o = await login("owner");

  const res = await postJson(`/api/users/${a._id}/deactivate`, {}, { Cookie: o });
  assert.equal(res.status, 400);
  assert.equal(json(res).error, "cannot deactivate the last active owner");
});

// --- HEADLINE: deactivate eviction through the REAL endpoint ---------------

test("HEADLINE — owner deactivates a worker; worker's next request 401s, session destroyed, cannot revive", async () => {
  const worker = await createUser({ username: "worker", password: "password123", role: "worker" });
  await createUser({ username: "owner", password: "password123", role: "owner" });

  const cookieW = await login("worker");
  const cookieO = await login("owner");
  assert.equal(await sessions().countDocuments(), 2);

  // Worker is live.
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieW } })).status, 200);

  // Owner deactivates the worker through the real endpoint.
  assert.equal((await postJson(`/api/users/${worker._id}/deactivate`, {}, { Cookie: cookieO })).status, 200);

  // Worker's next request with the same cookie is rejected and the session wiped.
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieW } })).status, 401);
  assert.equal(await sessions().countDocuments(), 1, "exactly one session (the worker's) destroyed");

  // Reactivating (no endpoint for it; direct write) does not revive the dead session.
  await User.updateOne({ _id: worker._id }, { $set: { isActive: true } });
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieW } })).status, 401, "destroyed session cannot revive");
});

// --- reset eviction -------------------------------------------------------

test("owner resets a worker's password: worker's existing session 401s next request; new password logs in", async () => {
  const worker = await createUser({ username: "worker", password: "password123", role: "worker" });
  await createUser({ username: "owner", password: "password123", role: "owner" });

  const cookieW = await login("worker");
  const cookieO = await login("owner");
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieW } })).status, 200);

  assert.equal(
    (await postJson(`/api/users/${worker._id}/reset-password`, { newPassword: "fresh12345" }, { Cookie: cookieO })).status,
    200
  );

  // Worker's existing session is evicted on its next request.
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieW } })).status, 401);
  // Old password no longer works; the new one does.
  assert.equal((await postJson("/api/auth/login", { username: "worker", password: "password123" })).status, 401);
  assert.equal((await postJson("/api/auth/login", { username: "worker", password: "fresh12345" })).status, 200);
});
