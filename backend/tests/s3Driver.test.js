import test from "node:test";
import assert from "node:assert/strict";

import { S3Driver } from "../src/lib/storage/s3Driver.js";

// A fake S3 client that records every command sent to it. We pass real AWS SDK
// command objects (PutObjectCommand/DeleteObjectCommand) through, so the asserts
// below verify the actual Bucket/Key/params the driver builds — only the network
// send() is faked. This mirrors how LocalDiskDriver tests inject a temp baseDir:
// a sibling driver wired to a fake backend, the interface itself untouched.
function makeFakeClient() {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push({ name: command.constructor.name, input: command.input });
      return {};
    },
  };
}

function makeDriver(overrides = {}) {
  return new S3Driver({
    client: makeFakeClient(),
    bucket: "spark-pos-images",
    publicBaseUrl: "https://img.example.com",
    ...overrides,
  });
}

test("put sends PutObjectCommand to the right bucket/key and returns a <hint>-<ts>.jpg key", async () => {
  const driver = makeDriver();
  const buf = Buffer.from("fake-jpeg-bytes");

  const key = await driver.put(buf, "656f1aitem99");

  assert.match(key, /^656f1aitem99-\d+\.jpg$/);
  assert.equal(driver.client.calls.length, 1);
  const { name, input } = driver.client.calls[0];
  assert.equal(name, "PutObjectCommand");
  assert.equal(input.Bucket, "spark-pos-images");
  assert.equal(input.Key, key);
  assert.equal(input.Body, buf);
  assert.equal(input.ContentType, "image/jpeg"); // bytes are always JPEG (Sharp upstream)
});

test("put sanitizes a messy keyHint into a valid, traversal-free key", async () => {
  const driver = makeDriver();
  const key = await driver.put(Buffer.from("x"), "../../etc/passwd");
  assert.match(key, /^[A-Za-z0-9-]+-\d+\.jpg$/); // slashes/dots stripped, like LocalDisk
  assert.equal(driver.client.calls[0].input.Key, key);
});

test("delete sends DeleteObjectCommand for the right bucket/key", async () => {
  const driver = makeDriver();
  await driver.delete("abc-123.jpg");
  assert.equal(driver.client.calls.length, 1);
  const { name, input } = driver.client.calls[0];
  assert.equal(name, "DeleteObjectCommand");
  assert.equal(input.Bucket, "spark-pos-images");
  assert.equal(input.Key, "abc-123.jpg");
});

test("urlFor returns an absolute public URL (joins base + key, no double slash)", () => {
  assert.equal(
    makeDriver().urlFor("abc-123.jpg"),
    "https://img.example.com/abc-123.jpg"
  );
  // trailing slash on the configured base is normalized away
  assert.equal(
    makeDriver({ publicBaseUrl: "https://img.example.com/" }).urlFor("abc-123.jpg"),
    "https://img.example.com/abc-123.jpg"
  );
});

test("missing config throws a clear error instead of silently misbehaving", () => {
  // No bucket configured and none in env → put/delete cannot proceed.
  const noBucket = new S3Driver({ client: makeFakeClient(), publicBaseUrl: "https://x" });
  assert.throws(() => noBucket.bucket, /R2_BUCKET/);

  const noUrl = new S3Driver({ client: makeFakeClient(), bucket: "b" });
  assert.throws(() => noUrl.urlFor("k"), /R2_PUBLIC_BASE_URL/);

  // No client and no credentials in env → client construction is refused.
  const noCreds = new S3Driver({ bucket: "b" });
  assert.throws(() => noCreds.client, /R2_ENDPOINT|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY/);
});
