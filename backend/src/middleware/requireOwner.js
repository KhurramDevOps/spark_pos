/**
 * Gate a route to the `owner` role (spec 002: bulk import is owner-only).
 * Reads req.userRole (set by currentUser; a placeholder until real auth lands).
 *
 * !!! PRODUCTION TODO !!!
 * This gate is only trustworthy once REAL authentication sets `req.userRole` from
 * an authenticated session/JWT. Today `currentUser` hard-codes the dev user as
 * "owner" (placeholder). DO NOT ship import to production until auth wires the
 * authenticated user's role into this gate — otherwise everyone is an "owner".
 */
export function requireOwner(req, res, next) {
  if (req.userRole !== "owner") {
    res.status(403);
    return next(new Error("this action is restricted to the owner"));
  }
  next();
}
