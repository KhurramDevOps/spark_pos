import express from "express";
import healthRoutes from "./routes/healthRoutes.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

/**
 * Builds the Express app with middleware and routes wired up, but does not
 * start listening — index.js does that after the DB is connected. Keeping the
 * app build separate makes it testable later.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  app.use("/api", healthRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
