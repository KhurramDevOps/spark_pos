import { z } from "zod";

// Auth & user validation (spec 007). Used by both frontend (UX) and backend
// (authoritative). Username is stored/compared lowercase, case-insensitive.

export const ROLE_VALUES = ["owner", "worker"];

// bcrypt only hashes the first 72 BYTES of a password — two long passwords that
// share a 72-byte prefix would hash equal. So we cap at 72 BYTES (not chars:
// multi-byte UTF-8 counts more) and reject anything longer instead of letting
// bcrypt silently truncate. TextEncoder works in both Node and the browser.
export const MAX_PASSWORD_BYTES = 72;
const byteLength = (s) => new TextEncoder().encode(s).length;

// 3–32 chars, lowercase letters / digits / underscore / hyphen only. No spaces,
// no @, no quotes (§7). `.toLowerCase()` first so "Ahmed" normalises to "ahmed".
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "username must be at least 3 characters")
  .max(32, "username must be at most 32 characters")
  .regex(/^[a-z0-9_-]+$/, "username may only contain lowercase letters, numbers, underscore, hyphen");

// Create/change password: min 8 (§7), max 72 bytes (bcrypt limit).
const password = z
  .string()
  .min(8, "password must be at least 8 characters")
  .refine((p) => byteLength(p) <= MAX_PASSWORD_BYTES, `password must be at most ${MAX_PASSWORD_BYTES} bytes`);

// Owner creates a worker — role is fixed to "worker" (owners cannot create
// owners; the only owner is the bootstrap owner — §4).
export const createUserSchema = z.object({
  username,
  password,
  role: z.literal("worker"),
});

// Owner creates a worker — role is NOT in the schema; it's hard-forced to
// "worker" server-side, so a role:"owner" in the body is silently dropped by
// Zod (this must never become a second owner-creation path — §4).
export const createWorkerSchema = z.object({ username, password });

// Bootstrap (first owner). Role is forced to "owner" server-side, never from
// the payload, so it isn't in the schema.
export const bootstrapSchema = z.object({ username, password });

// Login: deliberately lax (min 1) so an attacker can't distinguish "fails
// validation" from "wrong credentials" — both just fail auth. Lowercased to
// match the stored username.
export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

// A user changing their OWN password — must prove they know the current one.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

// An owner resetting someone else's password (no current-password proof).
export const resetPasswordSchema = z.object({ newPassword: password });
