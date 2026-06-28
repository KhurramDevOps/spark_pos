import test from "node:test";
import assert from "node:assert/strict";

import itemRoutes from "../src/routes/itemRoutes.js";
import categoryRoutes from "../src/routes/categoryRoutes.js";
import saleRoutes from "../src/routes/saleRoutes.js";
import customerRoutes from "../src/routes/customerRoutes.js";
import purchaseRoutes from "../src/routes/purchaseRoutes.js";
import supplierRoutes from "../src/routes/supplierRoutes.js";
import expenseRoutes from "../src/routes/expenseRoutes.js";
import drawerAdjustmentRoutes from "../src/routes/drawerAdjustmentRoutes.js";
import dailyCloseRoutes from "../src/routes/dailyCloseRoutes.js";
import reportRoutes from "../src/routes/reportsRoutes.js";
import importRoutes from "../src/routes/importRoutes.js";
import authRoutes from "../src/routes/authRoutes.js";
import userRoutes from "../src/routes/userRoutes.js";
import healthRoutes from "../src/routes/healthRoutes.js";

// Walk a router's mounted stack and return, for every route, the ordered list of
// auth guards AND Zod validators actually in its middleware chain (file-level
// router.use guards are prepended to each route). This reads the REAL stack, so a
// route added later without a guard — OR with its validator dropped — shows up
// here and fails the assertion below.
const TRACKED = new Set(["requireAuth", "requireOwner", "validate"]);
function actualGuards(router) {
  const fileLevel = [];
  const out = {};
  for (const layer of router.stack) {
    if (layer.route) {
      const method = Object.keys(layer.route.methods)[0].toUpperCase();
      const names = layer.route.stack.map((l) => l.name || l.handle?.name || "");
      const guards = names.filter((n) => TRACKED.has(n));
      out[`${method} ${layer.route.path}`] = [...fileLevel, ...guards];
    } else {
      // Validators are always per-route (never router.use), so only guards land here.
      const n = layer.name || layer.handle?.name;
      if (n === "requireAuth" || n === "requireOwner") fileLevel.push(n);
    }
  }
  return out;
}

const AUTH = ["requireAuth"];
const OWNER = ["requireAuth", "requireOwner"];
const NONE = [];
// Route also carries a Zod validator (validate(...)), which runs AFTER the guards.
// Appending it keeps the one ordered deepEqual asserting guards + validator + order.
const V = (guards) => [...guards, "validate"];

// The single source of truth: every route in every router → its expected guards.
// (§6 matrix.) Mixed files are per-route; uniform owner files are file-level.
const EXPECTED = {
  "/api/items": {
    router: itemRoutes,
    routes: {
      "GET /": AUTH,
      "GET /search": AUTH,
      "GET /negative-stock": OWNER,
      "POST /": V(OWNER),
      "GET /:id": AUTH,
      "GET /:id/opening": AUTH,
      "PATCH /:id": V(OWNER),
      "POST /:id/adjust": V(OWNER),
      "POST /:id/recalculate-cost": OWNER,
      "POST /:id/repair-opening-cost": V(OWNER),
      "POST /:id/deactivate": OWNER,
      "POST /:id/reactivate": OWNER,
      "POST /:id/image": OWNER, // multipart (handleUpload), not a Zod validator
      "DELETE /:id/image": OWNER,
    },
  },
  "/api/categories": {
    router: categoryRoutes,
    routes: { "GET /": AUTH, "POST /": V(OWNER), "POST /:id/deactivate": OWNER, "POST /:id/reactivate": OWNER },
  },
  "/api/sales": {
    router: saleRoutes,
    routes: {
      "GET /": AUTH,
      "POST /": V(AUTH),
      "GET /:id": AUTH,
      "POST /:id/void": OWNER,
      "GET /:id/returns": AUTH,
      "POST /:id/returns": V(AUTH),
    },
  },
  "/api/customers": {
    router: customerRoutes,
    routes: {
      "GET /": AUTH,
      "POST /": V(AUTH),
      "GET /:id": AUTH,
      "PATCH /:id": V(OWNER),
      "POST /:id/deactivate": OWNER,
      "POST /:id/reactivate": OWNER,
      "GET /:id/payments": AUTH,
      "POST /:id/payments": V(AUTH),
      "GET /:id/adjustments": AUTH,
      "POST /:id/adjustments": V(OWNER),
    },
  },
  "/api/purchases": {
    router: purchaseRoutes,
    routes: { "GET /": OWNER, "POST /": V(OWNER), "GET /:id": OWNER, "POST /:id/reverse": OWNER },
  },
  "/api/suppliers": {
    router: supplierRoutes,
    routes: {
      "GET /": OWNER,
      "POST /": V(OWNER),
      "GET /:id": OWNER,
      "PATCH /:id": V(OWNER),
      "POST /:id/deactivate": OWNER,
      "POST /:id/reactivate": OWNER,
      "GET /:id/payments": OWNER,
      "POST /:id/payments": V(OWNER),
      "GET /:id/returns": OWNER,
      "POST /:id/returns": V(OWNER),
    },
  },
  "/api/expenses": {
    router: expenseRoutes,
    routes: { "GET /": OWNER, "POST /": V(OWNER), "PATCH /:id": V(OWNER), "DELETE /:id": OWNER },
  },
  "/api/drawer-adjustments": {
    router: drawerAdjustmentRoutes,
    routes: { "GET /": OWNER, "POST /": V(OWNER) },
  },
  "/api/daily-close": {
    router: dailyCloseRoutes,
    routes: { "GET /": OWNER, "GET /lines": OWNER, "POST /": V(OWNER) },
  },
  "/api/reports": { router: reportRoutes, routes: { "GET /": V(OWNER) } },
  "/api/imports": {
    router: importRoutes,
    routes: { "GET /template": OWNER, "POST /preview": OWNER, "POST /commit": OWNER }, // preview = csvBody text parser, not validate
  },
  "/api/auth": {
    router: authRoutes,
    routes: {
      "POST /bootstrap": V(NONE),
      "POST /login": V(NONE),
      "POST /logout": NONE,
      "GET /me": AUTH,
      "POST /change-password": V(AUTH),
    },
  },
  "/api/users": {
    router: userRoutes,
    routes: { "GET /": OWNER, "POST /": V(OWNER), "POST /:id/deactivate": OWNER, "POST /:id/reset-password": V(OWNER) },
  },
  "/api": { router: healthRoutes, routes: { "GET /health": NONE } },
};

test("ENUMERATED GUARD TEST — every route's real middleware stack matches the §6 matrix", () => {
  const table = [];
  for (const [mount, { router, routes }] of Object.entries(EXPECTED)) {
    const actual = actualGuards(router);

    // Same set of routes (catches a new route added or one removed).
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(routes).sort(),
      `route set mismatch under ${mount}`
    );

    // Each route's guard chain matches exactly (order included → requireAuth first).
    for (const [sig, expected] of Object.entries(routes)) {
      assert.deepEqual(actual[sig], expected, `guard mismatch: ${mount} ${sig}`);
      const g = expected.length === 0 ? "— (exempt)" : expected.join(" + ");
      table.push(`${mount.padEnd(22)} ${sig.padEnd(28)} ${g}`);
    }
  }
  console.log("\n--- route → middleware (asserted) ---\n" + table.join("\n") + "\n");
});
