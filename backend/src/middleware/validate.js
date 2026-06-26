/**
 * Validate `req[source]` against a Zod schema. On success, the parsed (and
 * defaulted) data replaces the raw input at `req.validated`. On failure, a 400
 * with a readable message is passed to the error handler.
 *
 * @param {import("zod").ZodTypeAny} schema
 * @param {"body"|"query"|"params"} [source]
 */
export const validate =
  (schema, source = "body") =>
  // Named (not anonymous) so the enumerated route-guard test can see a validator
  // in a route's middleware stack and assert it wasn't dropped (routeGuards.test.js).
  function validate(req, res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      res.status(400);
      return next(new Error(message));
    }
    req.validated = result.data;
    next();
  };
