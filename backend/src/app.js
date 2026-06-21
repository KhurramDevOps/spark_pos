import express from "express";
import healthRoutes from "./routes/healthRoutes.js";
import itemRoutes from "./routes/itemRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import importRoutes from "./routes/importRoutes.js";
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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
