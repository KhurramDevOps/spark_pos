import { hasUsers } from "../lib/setupState.js";

// The single bootstrap path (slice 4 mounts the real handler here). Centralised
// so the gate and the bootstrap router agree on it.
export const BOOTSTRAP_PATH = "/api/auth/bootstrap";

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// The closed, enumerated public reads (ADR-015) — reachable with no auth and
// even before bootstrap. Nothing else is exempt.
function isExemptPublicRead(req) {
  if (req.method !== "GET") return false;
  return req.path === "/api/health" || req.path.startsWith("/api/static/items/");
}

function isBootstrapPath(req) {
  return req.path === BOOTSTRAP_PATH;
}

/**
 * Empty-DB setup gate (spec 007 §6). One middleware mounted ahead of the route
 * table — no per-route changes.
 *  - It guards the API only (paths under /api/). Frontend-serving routes (GET /,
 *    built assets, SPA deep-link fallbacks) are NEVER intercepted — otherwise,
 *    before an owner exists, the browser receives a 503 JSON body in place of
 *    index.html and the React app (which would render BootstrapPage) never boots.
 *  - Public reads are always allowed.
 *  - While no user exists: only the bootstrap route passes; every other /api route 503s.
 *  - Once an owner exists: the bootstrap route is closed (404); everything else
 *    falls through to normal auth.
 */
export function setupGate(req, res, next) {
  // Non-API requests (the SPA shell, assets, client routes) fall straight through
  // to express.static / the SPA fallback. The gate's 503 belongs on API calls,
  // never on the page load itself.
  if (!req.path.startsWith("/api/")) return next();

  if (isExemptPublicRead(req)) return next();

  if (!hasUsers()) {
    if (isBootstrapPath(req)) return next();
    return next(httpError("Setup required.", 503));
  }

  // Bootstrapped: bootstrap is over.
  if (isBootstrapPath(req)) return next(httpError("Not found", 404));
  return next();
}
