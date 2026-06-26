/**
 * Catch-all for unmatched routes — hands a 404 to the error handler below.
 */
export function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Central error handler. Express recognises it by its four arguments.
 * Keeps responses to a consistent JSON shape; logs the full error server-side.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status =
    err.status ||
    err.statusCode ||
    (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  // Intended errors (httpError → 4xx) carry user-facing messages and pass through.
  // Genuine 500s may carry raw internal detail (driver/runtime messages), so in
  // production they're masked to a generic message; dev keeps the real one. The
  // full error is logged server-side above regardless.
  const isProd = process.env.NODE_ENV === "production";
  const message = status >= 500 && isProd ? "Internal Server Error" : err.message || "Internal Server Error";
  res.status(status).json({ error: message });
}
