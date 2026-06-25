import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

import User from "../src/models/User.js";
import { createUser, verifyPassword, hashPassword } from "../src/services/authService.js";
import { createUserSchema, MAX_PASSWORD_BYTES } from "../../shared/validation/auth.js";

// Own DB per file (node --test runs files in parallel). Local Mongo is the
// single-node replica set rs0; no transactions here but the URI matches the
// project convention.
const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_auth?replicaSet=rs0";

const PASSWORD = "Sup3r-Secret_pw!"; // distinctive substring for the log-leak test

before(async () => {
  await mongoose.connect(TEST_URI);
  await User.init(); // build the unique username index before duplicate tests
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
});

// --- createUser / hashing -------------------------------------------------

test("createUser stores a bcrypt hash, never the plaintext, and never serializes it", async () => {
  const user = await createUser({ username: "ahmed", password: PASSWORD, role: "worker" });

  assert.notEqual(user.passwordHash, PASSWORD);
  assert.match(user.passwordHash, /^\$2[aby]\$/); // looks like a bcrypt hash
  assert.equal(await bcrypt.compare(PASSWORD, user.passwordHash), true);

  // The hash and lockout internals must not leak through JSON serialization.
  const json = user.toJSON();
  assert.equal(json.passwordHash, undefined);
  assert.equal(json.failedAttempts, undefined);
  assert.equal(json.lockedUntil, undefined);
  assert.equal(json.username, "ahmed");
});

test("username is case-insensitive: stored lowercase, duplicate rejected, login any case", async () => {
  await createUser({ username: "Ahmed", password: PASSWORD, role: "worker" });
  const stored = await User.findOne({});
  assert.equal(stored.username, "ahmed");

  // A different-case duplicate collides on the unique index.
  await assert.rejects(
    () => createUser({ username: "AHMED", password: PASSWORD, role: "worker" }),
    /username already taken/
  );

  // Login works regardless of the case typed.
  assert.equal((await verifyPassword("AHMED", PASSWORD)).ok, true);
  assert.equal((await verifyPassword("ahmed", PASSWORD)).ok, true);
});

// --- 72-byte cap ----------------------------------------------------------

test("password 72-byte cap is enforced by the service and the Zod schema", async () => {
  const tooLong = "a".repeat(MAX_PASSWORD_BYTES + 1); // 73 bytes

  await assert.rejects(() => hashPassword(tooLong), /at most 72 bytes/);
  await assert.rejects(
    () => createUser({ username: "longpw", password: tooLong, role: "worker" }),
    /at most 72 bytes/
  );

  // Validation layer rejects it too (same cap, different enforcement point).
  assert.equal(createUserSchema.safeParse({ username: "longpw", password: tooLong, role: "worker" }).success, false);
  // Exactly 72 bytes is allowed.
  assert.equal(
    createUserSchema.safeParse({ username: "okpw", password: "a".repeat(72), role: "worker" }).success,
    true
  );
});

// --- lockout --------------------------------------------------------------

test("5 failed attempts lock the account; a correct password during lockout still fails", async () => {
  await createUser({ username: "lockme", password: PASSWORD, role: "worker" });

  for (let i = 0; i < 5; i++) {
    const r = await verifyPassword("lockme", "wrong-password");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid");
  }

  // Now locked: even the correct password is rejected as "locked", not checked.
  const locked = await verifyPassword("lockme", PASSWORD);
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "locked");

  const doc = await User.findOne({ username: "lockme" });
  assert.ok(doc.lockedUntil && doc.lockedUntil.getTime() > Date.now());
});

test("lockout auto-expires by timestamp: correct password works once lockedUntil passes, and counters reset", async () => {
  await createUser({ username: "expireme", password: PASSWORD, role: "worker" });
  for (let i = 0; i < 5; i++) await verifyPassword("expireme", "wrong-password");

  // Simulate the 15-minute lock having elapsed (no real wait).
  await User.updateOne(
    { username: "expireme" },
    { $set: { lockedUntil: new Date(Date.now() - 1000), failedWindowStartedAt: new Date(Date.now() - 16 * 60 * 1000) } }
  );

  const r = await verifyPassword("expireme", PASSWORD);
  assert.equal(r.ok, true);

  const doc = await User.findOne({ username: "expireme" });
  assert.equal(doc.failedAttempts, 0);
  assert.equal(doc.lockedUntil, null);
});

test("a successful login resets failedAttempts to 0 (below the lockout threshold)", async () => {
  await createUser({ username: "resetme", password: PASSWORD, role: "worker" });
  for (let i = 0; i < 3; i++) await verifyPassword("resetme", "wrong-password");

  let doc = await User.findOne({ username: "resetme" });
  assert.equal(doc.failedAttempts, 3);

  assert.equal((await verifyPassword("resetme", PASSWORD)).ok, true);
  doc = await User.findOne({ username: "resetme" });
  assert.equal(doc.failedAttempts, 0);
  assert.equal(doc.failedWindowStartedAt, null);
  assert.ok(doc.lastLoginAt instanceof Date);
});

// --- isActive + unknown user ---------------------------------------------

test("a deactivated user with the correct password is rejected as inactive, not invalid", async () => {
  const u = await createUser({ username: "gone", password: PASSWORD, role: "worker" });
  await User.updateOne({ _id: u._id }, { $set: { isActive: false } });

  const r = await verifyPassword("gone", PASSWORD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "inactive");
});

test("an unknown username fails as 'invalid' without throwing (no enumeration)", async () => {
  const r = await verifyPassword("nobody", PASSWORD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid");
});

// --- no plaintext password in logs ---------------------------------------

test("no plaintext password appears in any console output across create + verify flows", async () => {
  const logged = [];
  const sink = (...args) => logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  for (const m of ["log", "info", "warn", "error", "debug"]) mock.method(console, m, sink);

  try {
    await createUser({ username: "quiet", password: PASSWORD, role: "worker" });
    await verifyPassword("quiet", PASSWORD); // success path
    await verifyPassword("quiet", "wrong-password"); // failure path
    await verifyPassword("nobody", PASSWORD); // unknown-user path
    // 72-byte rejection path — the error must not echo the password either.
    await createUser({ username: "x", password: "b".repeat(73), role: "worker" }).catch((e) => logged.push(e.message));
  } finally {
    mock.restoreAll();
  }

  const haystack = logged.join("\n");
  assert.equal(haystack.includes(PASSWORD), false, "plaintext password leaked into console output");
  assert.equal(haystack.includes("b".repeat(73)), false, "rejected password leaked into an error message");
});
