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
  "mongodb://127.0.0.1:27017/sparkpos_test_profile?replicaSet=rs0";

async function hit(path, opts) {
  const res = await fetch(`${base}${path}`, opts);
  res._body = await res.text();
  return res;
}
const json = (res) => (res._body ? JSON.parse(res._body) : null);
const sparkCookie = (res) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? null;
const cookiePair = (sc) => (sc ? sc.split(";")[0] : null);

const postJson = (path, body, headers = {}) =>
  hit(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

let server;
let base;

const login = async (username = "owner", password = "password123") =>
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
  await Promise.all([User.deleteMany({}), mongoose.connection.collection("sessions").deleteMany({})]);
  await createUser({ username: "owner", password: "password123", role: "owner" });
  setHasUsers(true);
});

// --- GET /me --------------------------------------------------------------

test("GET /api/auth/me requires auth (401 without a session)", async () => {
  assert.equal((await hit("/api/auth/me")).status, 401);
});

test("GET /api/auth/me returns only safe fields (no hash, no lockout internals)", async () => {
  const cookie = await login();
  const res = await hit("/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);

  const u = json(res).user;
  assert.equal(u.username, "owner");
  assert.equal(u.role, "owner");
  assert.ok("lastLoginAt" in u);
  // Secrets / internals stripped by toJSON.
  for (const f of ["passwordHash", "failedAttempts", "failedWindowStartedAt", "lockedUntil", "passwordChangedAt"]) {
    assert.equal(u[f], undefined, `${f} must not be exposed`);
  }
});

// --- change own password --------------------------------------------------

test("change password: correct current + valid new → new works on next login, old fails", async () => {
  const cookie = await login();
  const res = await postJson("/api/auth/change-password", { currentPassword: "password123", newPassword: "brandnew99" }, { Cookie: cookie });
  assert.equal(res.status, 200);

  // Old password no longer works; new one does.
  assert.equal((await postJson("/api/auth/login", { username: "owner", password: "password123" })).status, 401);
  assert.equal((await postJson("/api/auth/login", { username: "owner", password: "brandnew99" })).status, 200);
});

test("change password: wrong current password → 400, password unchanged", async () => {
  const cookie = await login();
  const res = await postJson("/api/auth/change-password", { currentPassword: "WRONG", newPassword: "brandnew99" }, { Cookie: cookie });
  assert.equal(res.status, 400);
  assert.equal(json(res).error, "current password is incorrect");

  // Unchanged: original still logs in, the attempted new one does not.
  assert.equal((await postJson("/api/auth/login", { username: "owner", password: "password123" })).status, 200);
  assert.equal((await postJson("/api/auth/login", { username: "owner", password: "brandnew99" })).status, 401);
});

test("change password: new password failing 72-byte/min-8 validation → 400 (same Zod as create)", async () => {
  const cookie = await login();

  const tooShort = await postJson("/api/auth/change-password", { currentPassword: "password123", newPassword: "short" }, { Cookie: cookie });
  assert.equal(tooShort.status, 400);

  const tooLong = await postJson("/api/auth/change-password", { currentPassword: "password123", newPassword: "a".repeat(73) }, { Cookie: cookie });
  assert.equal(tooLong.status, 400);

  // Password untouched — original still works.
  assert.equal((await postJson("/api/auth/login", { username: "owner", password: "password123" })).status, 200);
});

// --- session invalidation on password change ------------------------------

test("changing the password invalidates OTHER sessions but keeps the current one", async () => {
  const cookieA = await login(); // session A (does the change)
  const cookieB = await login(); // session B (a second device / possibly stolen)

  // Both work initially.
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieA } })).status, 200);
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieB } })).status, 200);

  // A changes the password.
  assert.equal(
    (await postJson("/api/auth/change-password", { currentPassword: "password123", newPassword: "brandnew99" }, { Cookie: cookieA })).status,
    200
  );

  // B is evicted on its next request; A survives.
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieB } })).status, 401, "other session evicted");
  assert.equal((await hit("/api/auth/me", { headers: { Cookie: cookieA } })).status, 200, "current session kept");
});
