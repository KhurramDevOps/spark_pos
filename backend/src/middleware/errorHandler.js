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
  const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(status).json({
    error: err.message || "Internal Server Error",
  });
}
