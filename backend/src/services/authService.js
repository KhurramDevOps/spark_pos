import bcrypt from "bcrypt";
import User, { ROLES } from "../models/User.js";
import { MAX_PASSWORD_BYTES } from "../../../shared/validation/auth.js";

// --- Tunables (spec 007 §6) ---
export const BCRYPT_COST = 12;
const MAX_FAILED = 5; // failures within the window before lockout
const WINDOW_MS = 15 * 60 * 1000; // rolling window for counting failures
const LOCK_MS = 15 * 60 * 1000; // how long a lockout lasts

const byteLength = (s) => new TextEncoder().encode(s).length;

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// A real hash to compare against when the username doesn't exist, so an unknown
// user takes ~the same time as a wrong password — no enumeration via timing.
// Computed once at module load.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", BCRYPT_COST);

/**
 * Hash a plaintext password. Enforces the bounds here too (defense in depth —
 * the Zod layer also enforces them) and never logs the input.
 */
export async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length < 8) {
    throw httpError("password must be at least 8 characters", 400);
  }
  if (byteLength(plain) > MAX_PASSWORD_BYTES) {
    // Reject rather than let bcrypt silently truncate at 72 bytes.
    throw httpError(`password must be at most ${MAX_PASSWORD_BYTES} bytes`, 400);
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Create a user with a hashed password. `role` defaults to "worker"; bootstrap
 * passes "owner" explicitly. Returns the saved user document.
 */
export async function createUser({ username, password, role = "worker" }, { createdBy = null } = {}) {
  if (!ROLES.includes(role)) throw httpError("invalid role", 400);
  const passwordHash = await hashPassword(password);
  try {
    return await User.create({ username, passwordHash, role, createdBy });
  } catch (e) {
    if (e?.code === 11000) throw httpError("username already taken", 409);
    throw e;
  }
}

/**
 * Verify a login attempt, applying lockout rules. Returns a discriminated
 * result — never throws for a bad credential, and never reveals whether the
 * username exists:
 *   { ok: true, user }                         — success
 *   { ok: false, reason: "invalid" }           — no such user OR wrong password
 *   { ok: false, reason: "locked" }            — too many recent failures
 *   { ok: false, reason: "inactive" }          — correct password, but deactivated
 * Message + status mapping happens at the endpoint (slice 5), keeping messages
 * generic. No password value is ever logged or returned.
 */
export async function verifyPassword(rawUsername, rawPassword) {
  const username = String(rawUsername ?? "").trim().toLowerCase();
  const password = String(rawPassword ?? "");
  const now = Date.now();

  const user = await User.findOne({ username });
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH); // equalize timing
    return { ok: false, reason: "invalid" };
  }

  // Locked: reject without even checking the password, so a correct password
  // during a lockout still fails (§8).
  if (user.lockedUntil && user.lockedUntil.getTime() > now) {
    return { ok: false, reason: "locked" };
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    await registerFailure(user, now);
    return { ok: false, reason: "invalid" };
  }

  // Correct password. Status checks come AFTER the password check so account
  // state isn't leaked to someone who doesn't already hold the password.
  if (!user.isActive) return { ok: false, reason: "inactive" };

  // Success: clear lockout state and stamp the login.
  user.failedAttempts = 0;
  user.failedWindowStartedAt = null;
  user.lockedUntil = null;
  user.lastLoginAt = new Date(now);
  await user.save();
  return { ok: true, user };
}

/**
 * Record a failed attempt against the rolling window. Opens a fresh window if
 * none is active or the current one has aged out; locks once MAX_FAILED is hit.
 */
async function registerFailure(user, now) {
  const windowStart = user.failedWindowStartedAt?.getTime();
  if (!windowStart || now - windowStart > WINDOW_MS) {
    user.failedWindowStartedAt = new Date(now);
    user.failedAttempts = 1;
  } else {
    user.failedAttempts += 1;
  }
  if (user.failedAttempts >= MAX_FAILED) {
    user.lockedUntil = new Date(now + LOCK_MS);
  }
  await user.save();
}
