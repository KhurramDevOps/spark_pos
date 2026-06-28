import test from "node:test";
import assert from "node:assert/strict";

import { BUNDLE_GAZ, splitGaz, formatBundleStock, perBundleFromPerGaz } from "../../shared/inventory/bundle.js";

test("BUNDLE_GAZ is the fixed universal constant 90", () => {
  assert.equal(BUNDLE_GAZ, 90);
});

test("splitGaz divides total gaz into whole bundles + loose gaz", () => {
  assert.deepEqual(splitGaz("450"), { bundles: 5, loose: 0 });
  assert.deepEqual(splitGaz("457.5"), { bundles: 5, loose: 7.5 });
  assert.deepEqual(splitGaz("40"), { bundles: 0, loose: 40 });
  assert.deepEqual(splitGaz("0"), { bundles: 0, loose: 0 });
});

test("splitGaz kills float noise in the loose remainder", () => {
  // 457.3 is not exactly representable; the naive remainder is 7.2999999999...
  assert.deepEqual(splitGaz("457.3"), { bundles: 5, loose: 7.3 });
});

test("formatBundleStock renders the bundles + loose display", () => {
  assert.equal(formatBundleStock("450"), "5 bundles");
  assert.equal(formatBundleStock("457.5"), "5 bundles + 7.5 gaz");
  assert.equal(formatBundleStock("40"), "40 gaz");
  assert.equal(formatBundleStock("0"), "0 gaz");
  assert.equal(formatBundleStock("90"), "1 bundle"); // singular
});

test("formatBundleStock shows negative stock honestly as raw gaz", () => {
  assert.equal(formatBundleStock("-5"), "-5 gaz");
});

test("perBundleFromPerGaz is the per-gaz price times 90 (display hint, exact integers)", () => {
  assert.equal(perBundleFromPerGaz(1000), 90000); // Rs 10/gaz -> Rs 900/bundle
  assert.equal(perBundleFromPerGaz(1056), 95040);
});
