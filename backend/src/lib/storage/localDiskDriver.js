import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default store: backend/uploads/items (this file lives at backend/src/lib/storage/).
const DEFAULT_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads/items");

// Keys are <hint>-<timestamp>.jpg — alnum + hyphen + .jpg only. Validating on every
// path build doubles as path-traversal protection for the public static route.
const KEY_RE = /^[A-Za-z0-9-]+\.jpg$/;

/**
 * Local-disk storage driver (spec 006b / ADR-012). Writes resized JPEG bytes to
 * disk and serves them via GET /api/static/items/:key. The bytes are already
 * resized by the caller (Sharp) — this driver is format-agnostic, it just persists.
 */
export class LocalDiskDriver {
  constructor({ baseDir = process.env.UPLOADS_DIR || DEFAULT_BASE } = {}) {
    this.baseDir = baseDir;
  }

  /** Absolute path for a key; throws on a malformed/unsafe key. */
  pathFor(key) {
    if (typeof key !== "string" || !KEY_RE.test(key)) throw new Error(`invalid storage key: ${key}`);
    return path.join(this.baseDir, key);
  }

  /** Write bytes; returns the generated key. keyHint is typically the itemId. */
  async put(buffer, keyHint) {
    const safeHint = String(keyHint ?? "").replace(/[^A-Za-z0-9-]/g, "") || "item";
    const key = `${safeHint}-${Date.now()}.jpg`;
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.pathFor(key), buffer);
    return key;
  }

  /** Remove bytes. Idempotent: a missing file is a no-op (best-effort cleanup, §6). */
  async delete(key) {
    try {
      await unlink(this.pathFor(key));
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
  }

  /** Public URL the frontend puts in <img src> (cache-bust ?v= added by the caller). */
  urlFor(key) {
    return `/api/static/items/${key}`;
  }
}
