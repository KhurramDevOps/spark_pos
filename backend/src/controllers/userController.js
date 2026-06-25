import User from "../models/User.js";
import { createUser, hashPassword } from "../services/authService.js";

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** List all users (active + inactive) — the read half of "view other users". */
export async function list(req, res, next) {
  try {
    const users = await User.find({}).sort({ createdAt: 1 });
    res.json({ users: users.map((u) => u.toJSON()) });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a worker. Role is hard-forced to "worker" here — never read from the
 * payload — so this can never become a second owner-creation path (§4). Bootstrap
 * stays the only way to make an owner. Username uniqueness (case-insensitive) is
 * enforced by createUser via the unique index.
 */
export async function createWorker(req, res, next) {
  try {
    const { username, password } = req.validated;
    const worker = await createUser({ username, password, role: "worker" }, { createdBy: req.userId });
    res.status(201).json({ user: worker.toJSON() });
  } catch (err) {
    next(err);
  }
}

/**
 * Deactivate a user (§6 self-protection). Order matters: the last-active-owner
 * invariant is checked BEFORE the self-check, so a sole owner self-deactivating
 * gets the "last active owner" rejection (the more important reason) while a
 * non-last owner self-deactivating gets the "self" rejection. The target's live
 * sessions die on their next request (slice 3's isActive recheck) — no extra work.
 */
export async function deactivate(req, res, next) {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return next(httpError("user not found", 404));
    if (!target.isActive) return next(httpError("user is already inactive", 400));

    if (target.role === "owner") {
      const activeOwners = await User.countDocuments({ role: "owner", isActive: true });
      if (activeOwners <= 1) return next(httpError("cannot deactivate the last active owner", 400));
    }
    if (String(target._id) === String(req.userId)) {
      return next(httpError("you cannot deactivate your own account", 400));
    }

    target.isActive = false;
    await target.save();
    res.json({ user: target.toJSON() });
  } catch (err) {
    next(err);
  }
}

/**
 * Owner resets another user's password (no current-password needed). Stamps
 * passwordChangedAt so the target's existing sessions are evicted on their next
 * request (slice 5), and clears any lockout so they can log in immediately.
 */
export async function resetPassword(req, res, next) {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return next(httpError("user not found", 404));

    const { newPassword } = req.validated;
    target.passwordHash = await hashPassword(newPassword);
    target.passwordChangedAt = new Date();
    target.failedAttempts = 0;
    target.failedWindowStartedAt = null;
    target.lockedUntil = null;
    await target.save();

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
