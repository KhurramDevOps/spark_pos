import session from "express-session";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";

// Session config (spec 007 §6 / ADR-014). Server-side sessions via
// express-session + connect-mongo so logout/deactivation/role-change revoke
// cleanly with no token blacklist.

// Non-default cookie name — NOT "connect.sid" / "session" — to avoid stack
// fingerprinting (§6).
export const SESSION_COOKIE_NAME = "spark.sid";

// 12-hour TTL, applied as a SLIDING window (rolling: true re-stamps the cookie
// and touches the store on every authenticated response).
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Build the session middleware. Reuses the live Mongoose connection's MongoClient
 * for the session store (no second pool), so Mongoose must be connected before
 * this is called. In production a real SESSION_SECRET is required and the secure
 * cookie + proxy trust are switched on.
 */
export function createSessionMiddleware() {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production");
  }

  const store = MongoStore.create({
    client: mongoose.connection.getClient(),
    dbName: mongoose.connection.name,
    collectionName: "sessions",
    ttl: SESSION_TTL_MS / 1000, // connect-mongo wants seconds
    touchAfter: 0, // update stored expiry on every touch → precise sliding expiry
  });

  return session({
    name: SESSION_COOKIE_NAME,
    // Dev/test fallback only; production is guarded above to require a real secret.
    secret: process.env.SESSION_SECRET || "dev-only-insecure-session-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true, // sliding expiry on activity
    proxy: isProd, // trust X-Forwarded-Proto from the HTTPS-terminating proxy
    store,
    cookie: {
      httpOnly: true, // not readable by JS
      secure: isProd, // HTTPS-only in production
      sameSite: "strict", // CSRF protection at the cookie level
      maxAge: SESSION_TTL_MS,
    },
  });
}
