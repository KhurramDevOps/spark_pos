import { Router } from "express";
import { dbStatus } from "../db.js";

const router = Router();

/**
 * GET /api/health
 * Liveness + DB-connectivity check. Used in Phase 0 to prove the full stack
 * (frontend -> backend -> MongoDB) is wired together.
 */
router.get("/health", (req, res) => {
  const db = dbStatus();
  res.json({
    status: "ok",
    db,
    time: new Date().toISOString(),
  });
});

export default router;
