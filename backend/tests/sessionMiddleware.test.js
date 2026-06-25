import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";

import { createSessionMiddleware, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../src/middleware/session.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_session?replicaSet=rs0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// express-session flushes Set-Cookie at writeHead (so `await fetch` resolves on
// headers) but defers res.end until AFTER store.set/touch completes. So to
// observe the server-side store we must DRAIN the body first. `hit` does that
// and stashes the text for parsing.
async function hit(path, opts, b = base) {
  const res = await fetch(`${b}${path}`, opts);
  res._body = await res.text();
  return res;
}
const json = (res) => JSON.parse(res._body);

// --- tiny cookie jar over fetch (Node 24 Headers.getSetCookie) ---
function sparkCookie(res) {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  return raw ?? null;
}
const cookiePair = (setCookie) => setCookie.split(";")[0]; // "spark.sid=value"
const attr = (setCookie, name) =>
  setCookie.split(";").map((s) => s.trim()).find((s) => s.toLowerCase().startsWith(name.toLowerCase()));

let server;
let base;

// A minimal app exercising the session middleware directly (login/logout
// endpoints proper land in slice 5; these fakes just set/read/destroy session).
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createSessionMiddleware());
  app.post("/login-fake", (req, res) => {
    req.session.userId = "u1";
    res.json({ ok: true });
  });
  app.get("/whoami", (req, res) => res.json({ userId: req.session.userId ?? null }));
  app.post("/logout-fake", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME);
      res.json({ ok: true });
    });
  });
  return app;
}

const sessions = () => mongoose.connection.collection("sessions");

before(async () => {
  await mongoose.connect(TEST_URI);
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
  await sessions().deleteMany({});
});

// --- cookie attributes ----------------------------------------------------

test("session cookie is HttpOnly, SameSite=Strict, non-default name, and NOT Secure in dev", async () => {
  const res = await hit("/login-fake", { method: "POST" });
  const sc = sparkCookie(res);
  assert.ok(sc, "a spark.sid cookie was set");

  // Non-default name (§6) — not connect.sid / session.
  assert.ok(sc.startsWith("spark.sid="));
  assert.equal(sc.includes("connect.sid"), false);

  assert.ok(attr(sc, "HttpOnly"), "HttpOnly present");
  assert.ok(/SameSite=Strict/i.test(sc), "SameSite=Strict present");
  // Dev (NODE_ENV != production): no Secure flag, so cookies work over http.
  assert.equal(/(^|;|\s)Secure(;|$)/i.test(sc), false, "Secure absent in dev");
});

test("cookie TTL is 12 hours (Expires ≈ now + 12h)", async () => {
  const res = await hit("/login-fake", { method: "POST" });
  // express-session serializes the TTL as an Expires date (not Max-Age).
  const expires = attr(sparkCookie(res), "Expires");
  assert.ok(expires, "Expires present");
  const ttl = new Date(expires.split("=")[1]).getTime() - Date.now();
  assert.ok(Math.abs(ttl - SESSION_TTL_MS) < 60_000, `TTL ~12h (got ${Math.round(ttl / 1000)}s)`);
});

// --- server-side store round-trip ----------------------------------------

test("session persists server-side across requests; absent cookie sees nothing", async () => {
  const login = await hit("/login-fake", { method: "POST" });
  const cookie = cookiePair(sparkCookie(login));
  assert.equal(await sessions().countDocuments(), 1, "one session stored");

  const withCookie = json(await hit("/whoami", { headers: { Cookie: cookie } }));
  assert.equal(withCookie.userId, "u1");

  const without = json(await hit("/whoami"));
  assert.equal(without.userId, null);
});

// --- logout: server-side AND client-side ----------------------------------

test("logout destroys the session server-side and clears the cookie client-side", async () => {
  const login = await hit("/login-fake", { method: "POST" });
  const cookie = cookiePair(sparkCookie(login));
  assert.equal(await sessions().countDocuments(), 1);

  const logout = await hit("/logout-fake", { method: "POST", headers: { Cookie: cookie } });
  // Client-side: a Set-Cookie that expires spark.sid (Max-Age=0 or past Expires).
  const cleared = logout.headers.getSetCookie().some(
    (c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(c)
  );
  assert.ok(cleared, "cookie cleared client-side");

  // Server-side: the stored session is gone — replaying the OLD cookie sees nothing.
  assert.equal(await sessions().countDocuments(), 0, "session removed from store");
  const replay = json(await hit("/whoami", { headers: { Cookie: cookie } }));
  assert.equal(replay.userId, null, "old cookie no longer resolves a session");
});

// --- sliding expiry -------------------------------------------------------

test("activity slides the expiry forward (rolling) server-side and in the cookie", async () => {
  const login = await hit("/login-fake", { method: "POST" });
  const cookie = cookiePair(sparkCookie(login));
  const expires1 = new Date(attr(sparkCookie(login), "Expires").split("=")[1]).getTime();
  const stored1 = (await sessions().findOne({})).expires.getTime();

  await sleep(1500); // let wall-clock advance past 1s resolution

  const active = await hit("/whoami", { headers: { Cookie: cookie } });
  const sc2 = sparkCookie(active);
  assert.ok(sc2, "rolling re-sends the cookie on an authenticated request");
  const expires2 = new Date(attr(sc2, "Expires").split("=")[1]).getTime();
  const stored2 = (await sessions().findOne({})).expires.getTime();

  assert.ok(expires2 > expires1, "cookie expiry slid forward");
  assert.ok(stored2 > stored1, "stored expiry slid forward");
});

// --- secure flag in production -------------------------------------------

test("in production the cookie is Secure (behind the HTTPS proxy)", async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.SESSION_SECRET;
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "test-production-secret";

  let prodServer;
  try {
    await new Promise((resolve) => {
      prodServer = buildApp().listen(0, "127.0.0.1", resolve);
    });
    const prodBase = `http://127.0.0.1:${prodServer.address().port}`;
    // proxy:true trusts X-Forwarded-Proto so express-session treats this as HTTPS
    // and actually emits the Secure cookie (it would otherwise withhold it on http).
    const res = await hit(
      "/login-fake",
      { method: "POST", headers: { "X-Forwarded-Proto": "https" } },
      prodBase
    );
    const sc = sparkCookie(res);
    assert.ok(sc, "cookie set in prod over forwarded https");
    assert.ok(/(^|;|\s)Secure(;|$)/i.test(sc), "Secure flag present in production");
  } finally {
    await new Promise((resolve) => prodServer.close(resolve));
    process.env.NODE_ENV = prevEnv;
    if (prevSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSecret;
  }
});
