import { Router } from "express";
import * as reports from "../controllers/reportsController.js";
import { validate } from "../middleware/validate.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { reportQuerySchema } from "../../../shared/validation/reports.js";

const router = Router();

// Owner-only, read-only (spec 006 §6). Single round-trip payload (getReport).
router.get("/", requireOwner, validate(reportQuerySchema, "query"), reports.get);

export default router;
