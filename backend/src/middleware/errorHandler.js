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
  // A *deliberate* error carries an intentional status: set on the error by
  // httpError() (err.status / err.statusCode), or on the response before throwing
  // (res.status(...)). A genuinely unexpected error — a raw Mongo/driver throw, a
  // programmer error — has none of these, so the status falls back to 500.
  const deliberateStatus =
    err.status ||
    err.statusCode ||
    (res.statusCode && res.statusCode !== 200 ? res.statusCode : null);
  const status = deliberateStatus || 500;

  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

  // Deliberate errors carry user-facing messages and pass through with their real
  // message — whatever the status. A 503 "Setup required." (and any other
  // intentional 4xx/5xx httpError) MUST reach the client to drive the bootstrap
  // flow. Only genuinely unexpected errors (no deliberate status) may leak raw
  // internal detail, so in production those alone are masked. The full real error
  // is logged server-side above in both cases.
  const isProd = process.env.NODE_ENV === "production";
  const masked = !deliberateStatus && isProd;
  const message = masked ? "Internal Server Error" : err.message || "Internal Server Error";
  res.status(status).json({ error: message });
}
