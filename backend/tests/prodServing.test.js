import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Prod-serving slice (chore(prod): serve built frontend). Build the app under
// NODE_ENV=production so the static-serving + SPA-fallback block is active, and
// prove the three carve-outs hold: a deep client route → index.html, /api/health
// → JSON (not the shell), and the image route still streams bytes.
//
// NODE_ENV + SESSION_SECRET must be set BEFORE createApp() runs (session.js reads
// them at build time and requires a real secret in prod). Image bytes are served
// from disk via the local storage driver, so point UPLOADS_DIR at a temp dir and
// drop a real file there.
process.env.NODE_ENV = "production";
process.env.SESSION_SECRET = "test-only-prod-secret";

const { createApp } = await import("../src/app.js");
const { setHasUsers } = await import("../src/lib/setupState.js");

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_prod?replicaSet=rs0";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let server;
let base;
let imageKey;

before(async () => {
  await mongoose.connect(TEST_URI);
  setHasUsers(true); // past the setup gate; /reports must reach the SPA fallback

  // Real image byte on disk under the local driver's base dir.
  const uploads = await mkdtemp(path.join(tmpdir(), "spark-prod-"));
  process.env.UPLOADS_DIR = uploads;
  imageKey = "item-1.jpg";
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, imageKey), PNG_BYTES);

  await new Promise((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  // createApp() builds the connect-mongo session store, which ensures a TTL index
  // on `sessions` in the background. Await an idempotent createIndex on the same
  // collection so that work is flushed before teardown disconnects the shared
  // client (otherwise its index build resolves post-disconnect → MongoExpiredSessionError).
  await mongoose.connection.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("deep client route /reports is served the SPA shell (index.html), not a 404", async () => {
  const res = await fetch(`${base}/reports`);
  const body = await res.text();
  assert.equal(res.status, 200, "/reports resolves");
  assert.match(res.headers.get("content-type") || "", /text\/html/, "served as HTML");
  assert.match(body, /<div id="root">/, "is the SPA shell");
  assert.doesNotMatch(body, /"error"/, "not a JSON error payload");
});

test("/api/health still returns JSON, NOT the SPA shell", async () => {
  const res = await fetch(`${base}/api/health`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /application\/json/, "JSON, not HTML");
  assert.equal(JSON.parse(body).status, "ok");
  assert.doesNotMatch(body, /<div id="root">/, "the fallback did not swallow it");
});

test("an unmatched /api/* path 404s as JSON, never the SPA shell", async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  const body = await res.text();
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  assert.doesNotMatch(body, /<div id="root">/, "no SPA shell for unmatched API paths");
});

test("the image bytes route still streams the file, not the SPA shell", async () => {
  const res = await fetch(`${base}/api/static/items/${imageKey}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.deepEqual(buf, PNG_BYTES, "exact bytes streamed from disk");
});
