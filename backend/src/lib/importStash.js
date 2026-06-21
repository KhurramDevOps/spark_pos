/**
 * Short-lived in-memory stash holding a parsed upload between preview and commit
 * (spec 002 §6 / ADR-004). Commit sends back only the token; the server re-reads
 * the stashed text and re-validates from scratch — it never trusts a
 * client-echoed preview. Entries expire after TTL_MS and are swept lazily.
 *
 * Process-local and non-durable on purpose: if the server restarts, the owner
 * simply re-uploads. The durable record of an import is the ImportLog.
 */
import { randomUUID } from "node:crypto";

const TTL_MS = 15 * 60 * 1000; // 15 minutes
export const TTL_SECONDS = TTL_MS / 1000;

const store = new Map(); // token -> { text, filename, createdBy, expiresAt }

/** Drop any expired entries. Cheap; called on every access. */
function sweep(now = Date.now()) {
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) store.delete(token);
  }
}

/**
 * Stash an upload, returning a fresh token.
 * @param {{ text: string, filename?: string, createdBy: any }} payload
 */
export function put({ text, filename, createdBy }) {
  sweep();
  const token = randomUUID();
  store.set(token, { text, filename, createdBy, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Fetch a stashed upload, or null if missing/expired. */
export function get(token) {
  sweep();
  const entry = store.get(token);
  return entry ?? null;
}

/** Remove a stashed upload (after commit). */
export function remove(token) {
  store.delete(token);
}

/** Test helper: wipe the stash. */
export function _clear() {
  store.clear();
}
