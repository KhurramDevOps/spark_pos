import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { createApp } from "../src/app.js";
import Item from "../src/models/Item.js";
import Category from "../src/models/Category.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_image_http?replicaSet=rs0";

let server, base, uploadsDir, categoryId;
const api = (p, opts) => fetch(`${base}${p}`, opts);

// A big PNG (2000x1500, random noise so it doesn't compress to nothing).
async function bigPng() {
  const w = 2000, h = 1500;
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
function form(buf, type, name) {
  const f = new FormData();
  f.append("file", new Blob([buf], { type }), name);
  return f;
}

before(async () => {
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), "sparkpos-img-"));
  process.env.UPLOADS_DIR = uploadsDir; // LocalDiskDriver resolves this lazily
  await mongoose.connect(TEST_URI);
  await Promise.all([Item.init(), Category.init()]);
  await new Promise((r) => (server = createApp().listen(0, "127.0.0.1", r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await rm(uploadsDir, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});
beforeEach(async () => {
  await Promise.all([Item.deleteMany({}), Category.deleteMany({})]);
  const cat = await Category.create({ name: "Fans", skuPrefix: "FAN", isActive: true });
  categoryId = cat._id;
});

async function mkItem() {
  return Item.create({ sku: `F${Date.now()}`, name: "Fan", categoryId, baseUnit: "piece", retailPrice: 150 });
}

test("upload → resized JPEG stored (≤800px, <200KB), Item.image kind=upload, served via /api/static", async () => {
  const item = await mkItem();
  const res = await api(`/api/items/${item._id}/image`, { method: "POST", body: form(await bigPng(), "image/png", "fan.png") });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.image.kind, "upload");
  assert.match(updated.image.ref, /\.jpg$/);

  // static route serves the bytes
  const img = await api(`/api/static/items/${updated.image.ref}`);
  assert.equal(img.status, 200);
  const bytes = Buffer.from(await img.arrayBuffer());

  const meta = await sharp(bytes).metadata();
  assert.equal(meta.format, "jpeg"); // always JPEG regardless of PNG input
  assert.ok(meta.width <= 800 && meta.height <= 800, `≤800px, got ${meta.width}x${meta.height}`);
  assert.ok(bytes.length < 200 * 1024, `<200KB, got ${bytes.length}`);
  assert.equal(meta.exif, undefined); // metadata stripped
});

test("replace upload → new key, old file deleted from disk", async () => {
  const item = await mkItem();
  const first = await (await api(`/api/items/${item._id}/image`, { method: "POST", body: form(await bigPng(), "image/png", "a.png") })).json();
  const second = await (await api(`/api/items/${item._id}/image`, { method: "POST", body: form(await bigPng(), "image/png", "b.png") })).json();
  assert.notEqual(first.image.ref, second.image.ref);
  assert.equal((await api(`/api/static/items/${first.image.ref}`)).status, 404); // old gone
  assert.equal((await api(`/api/static/items/${second.image.ref}`)).status, 200); // new served
});

test("DELETE clears Item.image and removes the file (404 after)", async () => {
  const item = await mkItem();
  const up = await (await api(`/api/items/${item._id}/image`, { method: "POST", body: form(await bigPng(), "image/png", "a.png") })).json();
  const res = await api(`/api/items/${item._id}/image`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).image == null); // unset → null/undefined, both "no image"
  assert.equal((await api(`/api/static/items/${up.image.ref}`)).status, 404);
});

test("PATCH with a URL sets Item.image kind=url; bad/dangerous URLs rejected", async () => {
  const item = await mkItem();
  const ok = await api(`/api/items/${item._id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: { kind: "url", ref: "https://cdn.example.com/fan.jpg" } }),
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).image.kind, "url");

  for (const bad of ["not a url", "javascript:alert(1)", "file:///etc/passwd"]) {
    const r = await api(`/api/items/${item._id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: { kind: "url", ref: bad } }),
    });
    assert.equal(r.status, 400, `expected 400 for ${bad}`);
  }
});

test("a .txt renamed to .jpg is rejected (Sharp can't decode); no image set", async () => {
  const item = await mkItem();
  const res = await api(`/api/items/${item._id}/image`, { method: "POST", body: form(Buffer.from("totally not an image"), "image/jpeg", "fake.jpg") });
  assert.equal(res.status, 400);
  assert.equal((await Item.findById(item._id)).image, null);
});

test("wrong MIME (text/plain) is rejected at the boundary", async () => {
  const item = await mkItem();
  const res = await api(`/api/items/${item._id}/image`, { method: "POST", body: form(Buffer.from("hi"), "text/plain", "x.txt") });
  assert.equal(res.status, 400);
});

test("a 15 MB upload is rejected (multer size cap), no file written", async () => {
  const item = await mkItem();
  const big = Buffer.alloc(15 * 1024 * 1024, 1);
  const res = await api(`/api/items/${item._id}/image`, { method: "POST", body: form(big, "image/jpeg", "huge.jpg") });
  assert.equal(res.status, 400);
  assert.equal((await Item.findById(item._id)).image, null);
});

test("orphan cleanup is best-effort: file already gone → DELETE still succeeds", async () => {
  const item = await mkItem();
  const up = await (await api(`/api/items/${item._id}/image`, { method: "POST", body: form(await bigPng(), "image/png", "a.png") })).json();
  await unlink(path.join(uploadsDir, up.image.ref)); // file vanishes out-of-band
  const res = await api(`/api/items/${item._id}/image`, { method: "DELETE" });
  assert.equal(res.status, 200); // no 500 even though the file was already gone
  assert.ok((await res.json()).image == null);
});

test("static route returns 404 for a missing or malformed key", async () => {
  assert.equal((await api(`/api/static/items/does-not-exist.jpg`)).status, 404);
  assert.equal((await api(`/api/static/items/..%2Fescape.jpg`)).status, 404);
});
