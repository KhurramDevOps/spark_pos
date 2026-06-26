import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import healthRoutes from "./routes/healthRoutes.js";
import itemRoutes from "./routes/itemRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import importRoutes from "./routes/importRoutes.js";
import purchaseRoutes from "./routes/purchaseRoutes.js";
import supplierRoutes from "./routes/supplierRoutes.js";
import saleRoutes from "./routes/saleRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import drawerAdjustmentRoutes from "./routes/drawerAdjustmentRoutes.js";
import dailyCloseRoutes from "./routes/dailyCloseRoutes.js";
import reportRoutes from "./routes/reportsRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { storage } from "./lib/storage/index.js";
import { createSessionMiddleware } from "./middleware/session.js";
import { setupGate } from "./middleware/setupGate.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

/**
 * Builds the Express app with middleware and routes wired up, but does not
 * start listening — index.js does that after the DB is connected. Keeping the
 * app build separate makes it testable later.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  // Server-side sessions (spec 007 / ADR-014). Must precede the gate and any
  // route that reads req.session. Requires Mongoose to be connected already.
  app.use(createSessionMiddleware());

  // Empty-DB setup gate: 503 everywhere until the first owner is bootstrapped
  // (except the two public reads + the bootstrap route itself); once an owner
  // exists, the bootstrap route 404s. One middleware, ahead of the route table.
  app.use(setupGate);

  // Auth endpoints (bootstrap / login / logout) — the only routes exempt from
  // requireAuth (ADR-015); they manage their own session.
  app.use("/api/auth", authRoutes);

  // Owner-only user management (spec 007 slice 6). requireAuth + requireOwner
  // applied at the router level.
  app.use("/api/users", userRoutes);

  app.use("/api", healthRoutes);
  app.use("/api/items", itemRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/imports", importRoutes);
  app.use("/api/purchases", purchaseRoutes);
  app.use("/api/suppliers", supplierRoutes);
  app.use("/api/sales", saleRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/expenses", expenseRoutes);
  app.use("/api/drawer-adjustments", drawerAdjustmentRoutes);
  app.use("/api/daily-close", dailyCloseRoutes);
  app.use("/api/reports", reportRoutes);

  // Public-read image bytes (spec 006b). Served under /api so the single Vite dev
  // proxy covers it. Only the local driver serves from disk; S3 returns absolute
  // URLs and never hits this route.
  app.get("/api/static/items/:key", (req, res) => {
    if (typeof storage.pathFor !== "function") return res.status(404).end();
    let filePath;
    try {
      filePath = storage.pathFor(req.params.key);
    } catch {
      return res.status(404).end();
    }
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // Production single-origin serving (forced by the SameSite=Strict cookie — there
  // is no Vite same-origin proxy in prod). Dev keeps using the Vite dev server, so
  // this whole block is gated on NODE_ENV=production. Mounted AFTER every /api route
  // and the image route above, so those are answered before static ever runs.
  if (process.env.NODE_ENV === "production") {
    const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");

    // Built assets: index.html at /, plus /assets/*, favicon, icons. For an /api/*
    // path no file matches, so this calls next() and the request 404s as JSON below.
    app.use(express.static(distDir));

    // SPA fallback: a deep client route (e.g. /reports) resolves to index.html so
    // client-side routing can take over. It must NOT swallow /api/* or the image
    // route — those already ran above; anything under /api that reached here is an
    // unmatched API path and must 404 as JSON (notFound), never return the shell.
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distDir, "index.html"), (err) => err && next(err));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
