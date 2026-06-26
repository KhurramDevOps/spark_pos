import { Router } from "express";
import * as sales from "../controllers/saleController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createSaleSchema } from "../../../shared/validation/sale.js";
import { createCustomerReturnSchema } from "../../../shared/validation/customerReturn.js";

const router = Router();

router.get("/", requireAuth, sales.list);
router.post("/", requireAuth, validate(createSaleSchema), sales.create);
router.get("/:id", requireAuth, sales.getOne);
router.post("/:id/void", requireAuth, requireOwner, sales.void_);
router.get("/:id/returns", requireAuth, sales.returns);
router.post("/:id/returns", requireAuth, validate(createCustomerReturnSchema), sales.recordReturn);

export default router;
