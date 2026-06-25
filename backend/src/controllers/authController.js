import mongoose from "mongoose";
import User from "../models/User.js";
import { hashPassword, verifyPassword, comparePassword } from "../services/authService.js";
import { migrateLegacyCreatedBy } from "../services/migrateCreatedBy.js";
import { setHasUsers } from "../lib/setupState.js";
import { SESSION_COOKIE_NAME } from "../middleware/session.js";

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Login failure → generic message + status. "invalid" is deliberately identical
// for unknown-username and wrong-password (no enumeration); "locked" and
// "inactive" are distinct (the user knows their own account state).
const LOGIN_FAILURES = {
  invalid: ["Invalid username or password", 401],
  locked: ["Too many failed attempts. Try again later.", 401],
  inactive: ["Account is inactive.", 401],
};

/**
 * Create the first owner (spec 007 §4). The setup gate only lets this through
 * while the users collection is empty; the count re-check here closes the race.
 * On success: open a session, flip the hasUsers cache, and run the one-time
 * legacy-createdBy migration.
 */
export async function bootstrap(req, res, next) {
  try {
    if ((await User.estimatedDocumentCount()) > 0) {
      return next(httpError("Not found", 404)); // bootstrap is over
    }
    const { username, password } = req.validated;
    // Hash outside the transaction (CPU-bound, no DB) so we don't hold it open
    // for the ~100ms bcrypt cost.
    const passwordHash = await hashPassword(password);

    // Owner-creation + legacy migration are one transaction (ADR-001): if the
    // migration throws partway, the owner rolls back too. Combined with the gate
    // still allowing bootstrap (we flip hasUsers only AFTER commit), that means a
    // failed bootstrap is a clean retry — never a half-migrated, unrecoverable
    // owner.
    let owner;
    let migration;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        [owner] = await User.create([{ username, passwordHash, role: "owner", createdBy: null }], { session });
        migration = await migrateLegacyCreatedBy(owner._id, session);
      });
    } finally {
      await session.endSession();
    }

    setHasUsers(true); // only now — past the point of rollback
    req.session.userId = String(owner._id);
    req.session.loginAt = Date.now();
    res.status(201).json({ user: owner.toJSON(), migrated: migration.total });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { username, password } = req.validated;
    const result = await verifyPassword(username, password);
    if (!result.ok) {
      const [message, status] = LOGIN_FAILURES[result.reason] ?? LOGIN_FAILURES.invalid;
      return next(httpError(message, status));
    }
    req.session.userId = String(result.user._id);
    req.session.loginAt = Date.now();
    res.json({ user: result.user.toJSON() });
  } catch (err) {
    next(err);
  }
}

/** Current user's safe profile (spec 007 slice 5). toJSON strips all secrets. */
export async function me(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("username role isActive lastLoginAt");
    res.json({ user: user.toJSON() });
  } catch (err) {
    next(err);
  }
}

/**
 * Change own password (§6 self-protection): must prove the current password.
 * Stamps passwordChangedAt (evicting every OTHER session on its next request)
 * and bumps THIS session's loginAt so the caller stays logged in.
 */
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.validated;
    const user = await User.findById(req.userId);
    if (!user) return next(httpError("authentication required", 401));

    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      return next(httpError("current password is incorrect", 400));
    }

    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await user.save();

    req.session.loginAt = user.passwordChangedAt.getTime(); // keep this session alive
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export function logout(req, res, next) {
  // Idempotent: destroying an absent session is fine.
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ ok: true });
  });
}
