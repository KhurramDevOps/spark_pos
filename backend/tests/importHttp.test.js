import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";
import StockMovement from "../src/models/StockMovement.js";
import Counter from "../src/models/Counter.js";
import { requireOwner } from "../src/middleware/requireOwner.js";
import { HEADERS } from "../src/lib/csvImport.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_import_http?replicaSet=rs0";

let server;
let base;
const api = (path, options) => fetch(`${base}${path}`, options);
const postCsv = (path, text) =>
  api(path, { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
const postJson = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const HEADER = HEADERS.join(",");

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Item.init(), Category.init(), StockMovement.init(), Counter.init()]);
  await new Promise((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    Item.deleteMany({}),
    Category.deleteMany({}),
    StockMovement.deleteMany({}),
    Counter.deleteMany({}),
  ]);
});

test("GET /imports/template downloads a CSV attachment with the locked headers", async () => {
  const res = await api("/imports/template");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  assert.match(res.headers.get("content-disposition"), /attachment/);
  const body = await res.text();
  assert.ok(body.startsWith(HEADER));
});

test("POST /imports/preview parses a raw text/csv body and returns a token + summary", async () => {
  const text = `${HEADER}\nGM wire,Wire,gaz,120,,,,\nbad,Misc,litre,100,,,,`;
  const res = await postCsv("/imports/preview", text);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.token);
  assert.equal(body.summary.toCreate, 1);
  assert.equal(body.summary.errors, 1);
  // Only the valid row's category counts — the error row creates nothing.
  assert.equal(body.summary.newCategories, 1);
});

test("POST /imports/preview with no content returns 422", async () => {
  const res = await postCsv("/imports/preview", "");
  assert.equal(res.status, 422);
});

test("full preview -> commit over HTTP creates the items", async () => {
  const text = `${HEADER}\nGM wire,Wire,gaz,120,,,5,`;
  const preview = await (await postCsv("/imports/preview", text)).json();
  assert.ok(preview.token);

  const res = await postJson("/imports/commit", { token: preview.token });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.counts.created, 1);
  assert.equal(await Item.countDocuments({}), 1);
});

test("POST /imports/commit without a token returns 400", async () => {
  const res = await postJson("/imports/commit", {});
  assert.equal(res.status, 400);
});

test("requireOwner blocks non-owners and lets owners through", () => {
  const run = (role) => {
    let status = 200;
    let nextErr;
    requireOwner(
      { userRole: role },
      { status: (s) => (status = s) },
      (err) => (nextErr = err)
    );
    return { status, nextErr };
  };

  const worker = run("worker");
  assert.equal(worker.status, 403);
  assert.match(worker.nextErr.message, /owner/);

  const owner = run("owner");
  assert.equal(owner.status, 200);
  assert.equal(owner.nextErr, undefined);
});
