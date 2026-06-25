import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { createWorkerSchema, resetPasswordSchema } from "../../../shared/validation/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import * as users from "../controllers/userController.js";

const router = Router();

// User management is uniformly owner-only → file-level guards (requireAuth then
// requireOwner) for every route here.
router.use(requireAuth, requireOwner);

router.get("/", users.list);
router.post("/", validate(createWorkerSchema), users.createWorker);
router.post("/:id/deactivate", users.deactivate);
router.post("/:id/reset-password", validate(resetPasswordSchema), users.resetPassword);

export default router;
