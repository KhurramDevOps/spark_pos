import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import { createUser } from "../src/services/authService.js";
import { SESSION_COOKIE_NAME } from "../src/middleware/session.js";
import { setHasUsers } from "../src/lib/setupState.js";

// Change-password must share login's lockout (the slice-5 open question): a valid
// session shouldn't be able to brute-force the current password unthrottled.

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_cplock?replicaSet=rs0";

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
const changePw = (cookie, currentPassword, newPassword = "brandnew99") =>
  postJson("/api/auth/change-password", { currentPassword, newPassword }, { Cookie: cookie });

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

test("5 wrong current-passwords lock change-password; a CORRECT current during lockout still fails", async () => {
  const cookie = await login();

  // Attempts 1–5 are wrong → each a plain 400 (below + at the threshold).
  for (let i = 0; i < 5; i++) {
    const r = await changePw(cookie, "WRONG");
    assert.equal(r.status, 400, `attempt ${i + 1} → 400 invalid`);
  }

  // Now locked: even the CORRECT current password is refused until the window clears.
  const locked = await changePw(cookie, "password123");
  assert.equal(locked.status, 429, "correct current during lockout still fails");
  assert.equal(json(locked).error, "Too many failed attempts. Try again later.");

  // Password genuinely unchanged — the original still works once unlocked.
  const u = await User.findOne({ username: "owner" });
  assert.ok(u.lockedUntil && u.lockedUntil.getTime() > Date.now(), "lockedUntil is set");
});

test("the lockout is the SAME counter as login — locking via change-password locks login too", async () => {
  const cookie = await login();
  for (let i = 0; i < 5; i++) await changePw(cookie, "WRONG");

  const loginLocked = await postJson("/api/auth/login", { username: "owner", password: "password123" });
  assert.equal(loginLocked.status, 401, "login is locked by the shared counter");
  assert.equal(json(loginLocked).error, "Too many failed attempts. Try again later.");
});

test("a successful change resets the failed-attempt counter (same as a successful login)", async () => {
  const cookie = await login();

  // 4 wrong attempts (below the 5 threshold), then a correct change.
  for (let i = 0; i < 4; i++) assert.equal((await changePw(cookie, "WRONG")).status, 400);

  const ok = await changePw(cookie, "password123", "brandnew99");
  assert.equal(ok.status, 200);

  const u = await User.findOne({ username: "owner" });
  assert.equal(u.failedAttempts, 0, "counter reset");
  assert.equal(u.failedWindowStartedAt, null);
  assert.equal(u.lockedUntil, null);
});
