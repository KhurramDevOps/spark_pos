import { Router } from "express";
import * as sales from "../controllers/saleController.js";
import { validate } from "../middleware/validate.js";
import { createSaleSchema } from "../../../shared/validation/sale.js";

const router = Router();

router.get("/", sales.list);
router.post("/", validate(createSaleSchema), sales.create);
router.get("/:id", sales.getOne);

export default router;
