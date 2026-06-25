import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { bootstrapSchema, loginSchema, changePasswordSchema } from "../../../shared/validation/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as auth from "../controllers/authController.js";

const router = Router();

// Bootstrap + login are the only routes exempt from requireAuth (ADR-015). The
// setup gate controls when bootstrap is reachable (empty DB only → else 404).
router.post("/bootstrap", validate(bootstrapSchema), auth.bootstrap);
router.post("/login", validate(loginSchema), auth.login);
router.post("/logout", auth.logout);

// Any logged-in user: own profile + self-service password change (§6).
router.get("/me", requireAuth, auth.me);
router.post("/change-password", requireAuth, validate(changePasswordSchema), auth.changePassword);

export default router;
