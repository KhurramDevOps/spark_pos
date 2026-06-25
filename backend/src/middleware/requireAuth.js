import User from "../models/User.js";

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Require an authenticated, still-active user (spec 007 §6 — the headline
 * invariant of this spec, ADR-014).
 *
 * On EVERY request it re-reads the session user's `{ username, role, isActive }`
 * from the DB (those three fields only — never the full document). This is what
 * makes deactivation and role changes take effect on the user's NEXT request
 * rather than at session-TTL expiry:
 *  - no session / unknown user  → 401
 *  - user.isActive === false    → DESTROY the live session, then 401. Destroying
 *    (not just rejecting) means the cookie can't revive itself if the account is
 *    ever reactivated — a revoked session is gone for good.
 *  - active                     → attach req.userId / req.userRole / req.username
 *    (fresh role, so requireOwner downstream reflects any mid-session change).
 */
export async function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next(httpError("authentication required", 401));

  let user;
  try {
    user = await User.findById(userId).select("username role isActive passwordChangedAt");
  } catch (err) {
    return next(err);
  }

  if (!user || !user.isActive) {
    // Wipe the server-side session so this cookie is permanently dead.
    return req.session.destroy(() => next(httpError("authentication required", 401)));
  }

  // Sessions issued before the user's last password change are evicted (a
  // password change kicks out every other, possibly stolen, session). The
  // session that performed the change has its loginAt bumped, so it survives.
  if (user.passwordChangedAt && (!req.session.loginAt || req.session.loginAt < user.passwordChangedAt.getTime())) {
    return req.session.destroy(() => next(httpError("authentication required", 401)));
  }

  req.userId = user._id;
  req.userRole = user.role;
  req.username = user.username;
  next();
}
