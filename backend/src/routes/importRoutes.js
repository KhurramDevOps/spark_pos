import { Router } from "express";
import express from "express";
import * as imports from "../controllers/importController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";

const router = Router();

// Bulk import is owner-only (spec 002).
router.use(requireAuth, requireOwner);

// The upload is the raw CSV text (no multipart library — ADR-004). The body
// parser limit is set ABOVE the 10 MB cap (§6) on purpose: the service enforces
// the real cap (MAX_BYTES / MAX_ROWS) so an over-cap file gets our friendly
// "split the file" message instead of a raw 413 from the body parser.
const csvBody = express.text({ type: ["text/csv", "text/plain"], limit: "12mb" });

router.get("/template", imports.template);
router.post("/preview", csvBody, imports.preview);
// Commit takes a small JSON body { token } (parsed by the app-level json parser).
router.post("/commit", imports.commit);

export default router;
