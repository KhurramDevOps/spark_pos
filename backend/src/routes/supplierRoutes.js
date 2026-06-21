import { Router } from "express";
import * as suppliers from "../controllers/supplierController.js";
import { validate } from "../middleware/validate.js";
import { createSupplierSchema, supplierPaymentSchema } from "../../../shared/validation/supplier.js";

const router = Router();

router.get("/", suppliers.list);
router.post("/", validate(createSupplierSchema), suppliers.create);
router.get("/:id", suppliers.getOne);
router.post("/:id/deactivate", suppliers.deactivate);
router.post("/:id/reactivate", suppliers.reactivate);
router.get("/:id/payments", suppliers.payments);
router.post("/:id/payments", validate(supplierPaymentSchema), suppliers.recordPayment);

export default router;
