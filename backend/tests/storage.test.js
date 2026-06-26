import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LocalDiskDriver, S3Driver, createDriver } from "../src/lib/storage/index.js";

let baseDir;
let driver;

before(async () => {
  baseDir = await mkdtemp(path.join(os.tmpdir(), "sparkpos-storage-"));
  driver = new LocalDiskDriver({ baseDir });
});
after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test("put writes bytes and returns a <hint>-<ts>.jpg key", async () => {
  const buf = Buffer.from("fake-jpeg-bytes");
  const key = await driver.put(buf, "656f1aitem99");
  assert.match(key, /^656f1aitem99-\d+\.jpg$/);
  const onDisk = await readFile(path.join(baseDir, key));
  assert.deepEqual(onDisk, buf);
});

test("put sanitizes a messy keyHint and still produces a valid key", async () => {
  const key = await driver.put(Buffer.from("x"), "../../etc/passwd");
  assert.match(key, /^[A-Za-z0-9-]+-\d+\.jpg$/); // traversal chars stripped
  await stat(path.join(baseDir, key)); // exists, inside baseDir
});

test("urlFor returns the /api/static path", () => {
  assert.equal(driver.urlFor("abc-123.jpg"), "/api/static/items/abc-123.jpg");
});

test("delete removes the file and is idempotent on a missing key", async () => {
  const key = await driver.put(Buffer.from("bye"), "todelete");
  await driver.delete(key);
  await assert.rejects(stat(path.join(baseDir, key))); // gone
  await driver.delete(key); // second delete: no throw (ENOENT swallowed)
});

test("pathFor rejects malformed / traversal keys", () => {
  assert.throws(() => driver.pathFor("../escape.jpg"), /invalid storage key/);
  assert.throws(() => driver.pathFor("notjpg.png"), /invalid storage key/);
  assert.throws(() => driver.pathFor(""), /invalid storage key/);
});

// S3Driver behavior is covered in tests/s3Driver.test.js (a fake S3 client) — it
// is a real driver now, no longer a "not implemented" stub.

test("createDriver selects by name and rejects unknown", () => {
  assert.ok(createDriver("local") instanceof LocalDiskDriver);
  assert.ok(createDriver("s3") instanceof S3Driver);
  assert.throws(() => createDriver("ftp"), /unknown STORAGE_DRIVER/);
});
