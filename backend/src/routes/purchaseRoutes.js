import { Router } from "express";
import * as purchases from "../controllers/purchaseController.js";
import { validate } from "../middleware/validate.js";
import { createPurchaseSchema } from "../../../shared/validation/purchase.js";

const router = Router();

router.get("/", purchases.list);
router.post("/", validate(createPurchaseSchema), purchases.create);
router.get("/:id", purchases.getOne);

export default router;
