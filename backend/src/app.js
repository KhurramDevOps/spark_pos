import express from "express";
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
import { storage } from "./lib/storage/index.js";
import { currentUser } from "./middleware/currentUser.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

/**
 * Builds the Express app with middleware and routes wired up, but does not
 * start listening — index.js does that after the DB is connected. Keeping the
 * app build separate makes it testable later.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  // PLACEHOLDER auth: attaches a dev userId until real login exists.
  app.use(currentUser);

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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
