import { Router } from "express";
import * as purchases from "../controllers/purchaseController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createPurchaseSchema } from "../../../shared/validation/purchase.js";

const router = Router();

// Owner-only (spec 003) — uniform file, guarded at the router level.
router.use(requireAuth, requireOwner);

router.get("/", purchases.list);
router.post("/", validate(createPurchaseSchema), purchases.create);
router.get("/:id", purchases.getOne);
router.post("/:id/reverse", purchases.reverse);

export default router;
