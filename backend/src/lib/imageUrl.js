import { storage } from "./storage/index.js";

/**
 * Resolve the public <img src> URL for an "upload"-kind item image, hiding which
 * storage driver is active (ADR-012). The ref is a storage key; the driver maps
 * it to a URL — the local static route (/api/static/items/<key>) or the R2 public
 * URL — and only the driver knows which. This is the single place that knowledge
 * lives; the frontend never branches on STORAGE_DRIVER.
 *
 * "url"-kind images are external links already; their ref is rendered directly by
 * the frontend, so they are not resolved here. Returns undefined when there's no
 * resolvable upload URL (no image, not an upload, or no ref).
 */
export function uploadImageUrl(image) {
  if (!image || image.kind !== "upload" || !image.ref) return undefined;
  return storage.urlFor(image.ref);
}

/**
 * Return a serialized image object with `url` attached for upload-kind images.
 * Used for plain/lean image objects (e.g. Reports aggregation) where the Mongoose
 * toJSON transform doesn't run. Null in → null out; url-kind passes through
 * unchanged.
 */
export function serializeImage(image) {
  if (!image) return null;
  const url = uploadImageUrl(image);
  return url ? { ...image, url } : { ...image };
}
