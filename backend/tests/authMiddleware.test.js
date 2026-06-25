import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";

import User from "../src/models/User.js";
import { createUser } from "../src/services/authService.js";
import { createSessionMiddleware, SESSION_COOKIE_NAME } from "../src/middleware/session.js";
import { requireAuth } from "../src/middleware/requireAuth.js";
import { requireOwner } from "../src/middleware/requireOwner.js";
import { setupGate, BOOTSTRAP_PATH } from "../src/middleware/setupGate.js";
import { setHasUsers } from "../src/lib/setupState.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_authmw?replicaSet=rs0";

// fetch resolves on headers; express-session writes the store on res.end, so we
// drain the body before asserting on the session store (slice-2 finding).
async function hit(path, opts) {
  const res = await fetch(`${base}${path}`, opts);
  res._body = await res.text();
  return res;
}
const json = (res) => JSON.parse(res._body);
const sparkCookie = (res) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? null;
const cookiePair = (sc) => sc.split(";")[0];
const sessions = () => mongoose.connection.collection("sessions");

let server;
let base;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createSessionMiddleware());
  app.use(setupGate);

  // Test-only session establisher (the real login endpoint is slice 4 — this
  // just does what login will do: look up the user, set session.userId).
  app.post("/test/login", async (req, res, next) => {
    try {
      const u = await User.findOne({ username: req.body.username });
      if (!u) return res.status(401).json({ error: "no such user" });
      req.session.userId = String(u._id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/protected", requireAuth, (req, res) => res.json({ userId: String(req.userId), role: req.userRole }));
  app.get("/api/owner-only", requireAuth, requireOwner, (req, res) => res.json({ ok: true }));

  // Exempt public reads (mimic the real health + image-bytes routes).
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/static/items/:key", (req, res) => res.type("text").send("imgbytes"));

  // Stub bootstrap handler — the gate controls its reachability; the real
  // owner-creating handler lands in slice 4.
  app.post(BOOTSTRAP_PATH, (req, res) => res.json({ bootstrapped: true }));

  app.use(errorHandler);
  return app;
}

const login = async (username) =>
  cookiePair(
    sparkCookie(
      await hit("/test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      })
    )
  );

const mkOwner = () => createUser({ username: "owner", password: "password123", role: "owner" });
const mkWorker = () => createUser({ username: "worker", password: "password123", role: "worker" });

before(async () => {
  await mongoose.connect(TEST_URI);
  await User.init();
  await new Promise((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
  await sessions().deleteMany({});
  setHasUsers(true); // default: system bootstrapped (the 503 test overrides)
});

// --- requireAuth ----------------------------------------------------------

test("requireAuth: 401 unauthenticated, next() when authenticated", async () => {
  await mkWorker();

  const anon = await hit("/api/protected");
  assert.equal(anon.status, 401);

  const cookie = await login("worker");
  const ok = await hit("/api/protected", { headers: { Cookie: cookie } });
  assert.equal(ok.status, 200);
  assert.equal(json(ok).role, "worker");
});

// --- requireOwner ---------------------------------------------------------

test("requireOwner: 403 for a worker session, 200 for an owner session", async () => {
  await mkOwner();
  await mkWorker();

  const workerCookie = await login("worker");
  assert.equal((await hit("/api/owner-only", { headers: { Cookie: workerCookie } })).status, 403);

  const ownerCookie = await login("owner");
  assert.equal((await hit("/api/owner-only", { headers: { Cookie: ownerCookie } })).status, 200);
});

// --- HEADLINE: active-session revocation ----------------------------------

test("HEADLINE — deactivating a logged-in worker 401s their next request AND destroys the live session (no revival)", async () => {
  await mkOwner();
  const worker = await mkWorker();

  // 1–2. Worker and owner both have live sessions; worker reaches a protected route.
  const workerCookie = await login("worker");
  const ownerCookie = await login("owner");
  assert.equal(await sessions().countDocuments(), 2);
  assert.equal((await hit("/api/protected", { headers: { Cookie: workerCookie } })).status, 200);

  // 3. Owner deactivates the worker. (The owner-driven deactivate ENDPOINT is
  //    slice 6; here we apply the state change the endpoint will make — the
  //    property under test is requireAuth's per-request recheck.)
  await User.updateOne({ _id: worker._id }, { $set: { isActive: false } });

  // 4. Worker's NEXT request with the same cookie is rejected.
  assert.equal((await hit("/api/protected", { headers: { Cookie: workerCookie } })).status, 401);

  // 5. The worker's session is DESTROYED server-side (owner's survives).
  assert.equal(await sessions().countDocuments(), 1, "only the worker's session was wiped");

  // …and even if the worker is later reactivated, the old cookie can't revive
  // the dead session.
  await User.updateOne({ _id: worker._id }, { $set: { isActive: true } });
  assert.equal((await hit("/api/protected", { headers: { Cookie: workerCookie } })).status, 401, "destroyed session cannot revive");

  // The owner's separate session was never touched.
  assert.equal((await hit("/api/protected", { headers: { Cookie: ownerCookie } })).status, 200);
});

// --- role change reflected per request ------------------------------------

test("a mid-session role change is reflected on the next request (fresh role, no re-login)", async () => {
  await mkOwner();
  const worker = await mkWorker();
  const workerCookie = await login("worker");

  // As a worker: owner-only route is forbidden.
  assert.equal((await hit("/api/owner-only", { headers: { Cookie: workerCookie } })).status, 403);

  // Promote to owner mid-session (future "reset role" admin action).
  await User.updateOne({ _id: worker._id }, { $set: { role: "owner" } });

  // Same cookie, next request: now allowed, and the protected route reports the
  // fresh role — the session was NOT destroyed, just re-read.
  assert.equal((await hit("/api/owner-only", { headers: { Cookie: workerCookie } })).status, 200);
  assert.equal(json(await hit("/api/protected", { headers: { Cookie: workerCookie } })).role, "owner");
});

// --- the per-request DB lookup actually happens ---------------------------

test("requireAuth re-reads the user from the DB on every request (not cached in the session)", async () => {
  await mkWorker();
  const cookie = await login("worker");

  const spy = mock.method(User, "findById"); // spies, still calls through
  try {
    await hit("/api/protected", { headers: { Cookie: cookie } });
    await hit("/api/protected", { headers: { Cookie: cookie } });
    assert.equal(spy.mock.callCount(), 2, "one user lookup per protected request");
  } finally {
    mock.restoreAll();
  }
});

// --- public-route carve-outs ----------------------------------------------

test("public reads (health + image bytes) bypass auth entirely", async () => {
  await mkWorker(); // system bootstrapped, but no cookie sent

  const health = await hit("/api/health");
  assert.equal(health.status, 200);

  const img = await hit("/api/static/items/some-key.jpg");
  assert.equal(img.status, 200);
  assert.equal(img._body, "imgbytes");
});

// --- empty-DB 503 gate ----------------------------------------------------

test("503 gate: empty users → only bootstrap + public reads pass; once bootstrapped → bootstrap 404s", async () => {
  // Pre-bootstrap: no users.
  setHasUsers(false);

  assert.equal((await hit("/api/protected")).status, 503, "protected route 503 before bootstrap");
  assert.equal((await hit("/api/auth/bootstrap", { method: "POST" })).status, 200, "bootstrap allowed before bootstrap");
  assert.equal((await hit("/api/health")).status, 200, "health exempt even pre-bootstrap");
  assert.equal((await hit("/api/static/items/x.jpg")).status, 200, "image bytes exempt even pre-bootstrap");

  // Post-bootstrap: an owner now exists.
  await mkOwner();
  setHasUsers(true);

  assert.equal((await hit("/api/auth/bootstrap", { method: "POST" })).status, 404, "bootstrap closed once an owner exists");
  // Gate no longer 503s — it falls through to auth (401 without a cookie).
  assert.equal((await hit("/api/protected")).status, 401, "gate falls through to auth after bootstrap");
});
