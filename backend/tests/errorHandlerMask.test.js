import test from "node:test";
import assert from "node:assert/strict";

import { errorHandler } from "../src/middleware/errorHandler.js";
import { setupGate } from "../src/middleware/setupGate.js";
import { hasUsers, setHasUsers } from "../src/lib/setupState.js";

// Production masking is scoped to *genuinely unexpected* errors (raw Mongo/driver
// throws, programmer errors — no deliberate status). Errors raised deliberately
// (httpError → err.status, or res.status(...) before throwing) keep their real
// user-facing message, whatever the status — a 4xx OR an intentional 5xx like the
// 503 "Setup required." that drives bootstrap. The full error is logged regardless.

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

test("prod: a genuinely unhandled error (no deliberate status) is masked to a generic message", () => {
  withEnv("production", () => {
    const res = mockRes();
    // Raw throw: no err.status, res.statusCode still 200 → status falls back to 500.
    errorHandler(new Error("ECONNREFUSED mongodb://secret-host internal detail"), req, res, () => {});
    assert.equal(res._status, 500);
    assert.equal(res._json.error, "Internal Server Error");
  });
});

test("prod: a 4xx httpError (wrong password) keeps its real message unchanged", () => {
  withEnv("production", () => {
    const res = mockRes();
    const err = new Error("current password is incorrect");
    err.status = 400;
    errorHandler(err, req, res, () => {});
    assert.equal(res._status, 400);
    assert.equal(res._json.error, "current password is incorrect");
  });
});

test("prod: a deliberate 503 httpError keeps its real message (the bug — was masked to 500-generic)", () => {
  withEnv("production", () => {
    const res = mockRes();
    const err = new Error("Setup required.");
    err.status = 503; // intentional 5xx — must NOT be masked
    errorHandler(err, req, res, () => {});
    assert.equal(res._status, 503);
    assert.equal(res._json.error, "Setup required.");
  });
});

test("prod: any other deliberate 5xx httpError also keeps its real message", () => {
  withEnv("production", () => {
    const res = mockRes();
    const err = new Error("upstream payment gateway timeout");
    err.status = 502;
    errorHandler(err, req, res, () => {});
    assert.equal(res._status, 502);
    assert.equal(res._json.error, "upstream payment gateway timeout");
  });
});

test("prod: a status set on the response (validation 400, plain Error) is deliberate and kept", () => {
  withEnv("production", () => {
    const res = mockRes();
    res.status(400); // validate.js sets this before throwing a plain Error (no err.status)
    errorHandler(new Error("name: Required"), { method: "POST", originalUrl: "/api/items" }, res, () => {});
    assert.equal(res._status, 400);
    assert.equal(res._json.error, "name: Required");
  });
});

test("prod REGRESSION: setupGate's 503 reaches the client unmasked through the REAL handlers", () => {
  // The exact prod path that broke: setupGate raises the 503, errorHandler emits
  // the body. setupState is in-memory, so no DB is needed to reproduce it.
  const prev = hasUsers();
  withEnv("production", () => {
    setHasUsers(false); // empty DB → gate is closed
    try {
      let captured;
      const gateReq = { method: "GET", path: "/api/sales", originalUrl: "/api/sales" };
      setupGate(gateReq, mockRes(), (e) => { captured = e; });
      assert.ok(captured, "setupGate raised an error");
      assert.equal(captured.status, 503);

      const res = mockRes();
      errorHandler(captured, { method: "GET", originalUrl: "/api/sales" }, res, () => {});
      assert.equal(res._status, 503);
      assert.equal(res._json.error, "Setup required."); // NOT "Internal Server Error"
    } finally {
      setHasUsers(prev); // restore for other tests
    }
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
