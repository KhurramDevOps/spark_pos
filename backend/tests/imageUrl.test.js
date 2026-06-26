import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { uploadImageUrl, serializeImage } from "../src/lib/imageUrl.js";

// uploadImageUrl/serializeImage delegate to the process-wide `storage` driver
// (selected by STORAGE_DRIVER at import). We can't re-import a different singleton
// per test, but we CAN verify the resolution logic against a stub urlFor — and the
// driver-specific urlFor outputs are already covered in storage.test.js /
// s3Driver.test.js. Here we lock the kind-branching: only upload-kind resolves.
import { storage } from "../src/lib/storage/index.js";

let originalUrlFor;
beforeEach(() => {
  originalUrlFor = storage.urlFor;
});
afterEach(() => {
  storage.urlFor = originalUrlFor;
});

test("upload-kind resolves via the active driver's urlFor (local-style path)", () => {
  storage.urlFor = (key) => `/api/static/items/${key}`;
  assert.equal(
    uploadImageUrl({ kind: "upload", ref: "abc-123.jpg" }),
    "/api/static/items/abc-123.jpg"
  );
});

test("upload-kind resolves via the active driver's urlFor (s3-style absolute URL)", () => {
  storage.urlFor = (key) => `https://img.example.com/${key}`;
  assert.equal(
    uploadImageUrl({ kind: "upload", ref: "abc-123.jpg" }),
    "https://img.example.com/abc-123.jpg"
  );
});

test("url-kind, missing, and ref-less images do NOT resolve (urlFor never called)", () => {
  let called = false;
  storage.urlFor = () => {
    called = true;
    return "x";
  };
  assert.equal(uploadImageUrl({ kind: "url", ref: "https://ext/p.jpg" }), undefined);
  assert.equal(uploadImageUrl(null), undefined);
  assert.equal(uploadImageUrl({ kind: "upload" }), undefined); // no ref
  assert.equal(called, false);
});

test("serializeImage attaches url for upload-kind, passes url-kind through, null→null", () => {
  storage.urlFor = (key) => `https://img.example.com/${key}`;

  assert.deepEqual(
    serializeImage({ kind: "upload", ref: "abc-123.jpg", updatedAt: "t" }),
    { kind: "upload", ref: "abc-123.jpg", updatedAt: "t", url: "https://img.example.com/abc-123.jpg" }
  );

  // url-kind is untouched — no url field added.
  assert.deepEqual(
    serializeImage({ kind: "url", ref: "https://ext/p.jpg", updatedAt: "t" }),
    { kind: "url", ref: "https://ext/p.jpg", updatedAt: "t" }
  );

  assert.equal(serializeImage(null), null);
});
