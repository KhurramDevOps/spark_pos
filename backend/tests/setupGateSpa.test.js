import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// REGRESSION (what broke the live deploy): the setup gate was mounted top-level
// and intercepted GET / itself, returning a 503 JSON body in place of index.html
// — so the React app never booted and could never render BootstrapPage. The gate
// must guard /api routes ONLY; frontend-serving routes always fall through.
//
// Build the app under NODE_ENV=production (so static + SPA-fallback are active)
// and PRE-bootstrap (no owner yet — setHasUsers(false)), the exact failing state.
process.env.NODE_ENV = "production";
process.env.SESSION_SECRET = "test-only-prod-secret";

const { createApp } = await import("../src/app.js");
const { setHasUsers } = await import("../src/lib/setupState.js");

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_setupgate_spa?replicaSet=rs0";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let server;
let base;
let imageKey;

before(async () => {
  await mongoose.connect(TEST_URI);
  // Pre-create the sessions collection up front and await it, so connect-mongo's
  // background collection/index setup isn't still pending when after() drops the
  // DB (else "Cannot create collection … database is in the process of being
  // dropped" lands as async activity after the test and fails the file).
  await mongoose.connection.createCollection("sessions").catch(() => {});
  setHasUsers(false); // PRE-bootstrap: no owner exists, the gate is closed

  // A real image byte on disk for the public image-route carve-out.
  const uploads = await mkdtemp(path.join(tmpdir(), "spark-gate-spa-"));
  process.env.UPLOADS_DIR = uploads;
  imageKey = "item-1.jpg";
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, imageKey), PNG_BYTES);

  await new Promise((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  // Flush the session store's background TTL index before teardown disconnects.
  await mongoose.connection.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("pre-bootstrap: GET / serves the SPA shell (200 HTML), NOT a 503 JSON error", async () => {
  const res = await fetch(`${base}/`);
  const body = await res.text();
  assert.equal(res.status, 200, "the page itself loads");
  assert.match(res.headers.get("content-type") || "", /text\/html/, "served as HTML");
  assert.match(body, /<div id="root">/, "is the real SPA shell");
});

test("pre-bootstrap: GET / response is NOT JSON (catches the exact prod regression)", async () => {
  const res = await fetch(`${base}/`);
  const body = await res.text();
  assert.doesNotMatch(res.headers.get("content-type") || "", /application\/json/, "not a JSON response");
  assert.doesNotMatch(body, /"error"/, "no error payload leaked onto the page");
  assert.doesNotMatch(body, /Setup required/, "the 503 message never lands on the page load");
});

test("pre-bootstrap: a deep SPA route (GET /reports) also falls through to the shell, not 503", async () => {
  const res = await fetch(`${base}/reports`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /<div id="root">/, "client route resolves to index.html");
});

test("pre-bootstrap: a business API route (GET /api/sales) still 503s 'Setup required'", async () => {
  const res = await fetch(`${base}/api/sales`);
  const body = await res.text();
  assert.equal(res.status, 503, "the gate still closes the API");
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  assert.match(JSON.parse(body).error, /Setup required/, "real gate message reaches the API client");
});

test("pre-bootstrap: GET /api/health is still exempt (200 JSON)", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(await res.text()).status, "ok");
});

test("pre-bootstrap: the image route is still exempt (streams bytes)", async () => {
  const res = await fetch(`${base}/api/static/items/${imageKey}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.deepEqual(buf, PNG_BYTES);
});

test("pre-bootstrap: the bootstrap route itself is still reachable (not gated)", async () => {
  // It exists and is not 503'd by the gate (it 4xx's on a bad/empty body, but the
  // point is the gate let it through rather than returning 503 Setup required).
  const res = await fetch(`${base}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.notEqual(res.status, 503, "bootstrap is not blocked by the gate");
});
