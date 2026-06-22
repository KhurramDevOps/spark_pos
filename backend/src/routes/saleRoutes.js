import { Router } from "express";
import * as sales from "../controllers/saleController.js";
import { validate } from "../middleware/validate.js";
import { createSaleSchema } from "../../../shared/validation/sale.js";
import { createCustomerReturnSchema } from "../../../shared/validation/customerReturn.js";

const router = Router();

router.get("/", sales.list);
router.post("/", validate(createSaleSchema), sales.create);
router.get("/:id", sales.getOne);
router.post("/:id/void", sales.void_);
router.get("/:id/returns", sales.returns);
router.post("/:id/returns", validate(createCustomerReturnSchema), sales.recordReturn);

export default router;
