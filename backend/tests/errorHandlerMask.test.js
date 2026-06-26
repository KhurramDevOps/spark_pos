import test from "node:test";
import assert from "node:assert/strict";

import { errorHandler } from "../src/middleware/errorHandler.js";

// In production, genuine 500s (unexpected/internal errors) must not leak their raw
// message to the client — only the intended 4xx (httpError) messages pass through.

function mockRes() {
  return {
    statusCode: 200,
    _status: null,
    _json: null,
    status(c) { this._status = c; this.statusCode = c; return this; },
    json(b) { this._json = b; return this; },
  };
}
const req = { method: "GET", originalUrl: "/api/anything" };

function withEnv(env, fn) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
}

test("prod: a genuine 500 is masked to a generic message", () => {
  withEnv("production", () => {
    const res = mockRes();
    errorHandler(new Error("ECONNREFUSED mongodb://secret-host internal detail"), req, res, () => {});
    assert.equal(res._status, 500);
    assert.equal(res._json.error, "Internal Server Error");
  });
});

test("prod: a 4xx (httpError) keeps its real message unchanged", () => {
  withEnv("production", () => {
    const res = mockRes();
    const err = new Error("current password is incorrect");
    err.status = 400;
    errorHandler(err, req, res, () => {});
    assert.equal(res._status, 400);
    assert.equal(res._json.error, "current password is incorrect");
  });
});

test("dev: a 500 keeps its real message (debugging)", () => {
  withEnv("development", () => {
    const res = mockRes();
    errorHandler(new Error("raw internal detail"), req, res, () => {});
    assert.equal(res._status, 500);
    assert.equal(res._json.error, "raw internal detail");
  });
});
