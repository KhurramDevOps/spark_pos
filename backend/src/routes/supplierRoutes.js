import { Router } from "express";
import * as suppliers from "../controllers/supplierController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import {
  createSupplierSchema,
  updateSupplierSchema,
  supplierPaymentSchema,
} from "../../../shared/validation/supplier.js";
import { createSupplierReturnSchema } from "../../../shared/validation/supplierReturn.js";

const router = Router();

// Owner-only (spec 003) — uniform file, guarded at the router level.
router.use(requireAuth, requireOwner);

router.get("/", suppliers.list);
router.post("/", validate(createSupplierSchema), suppliers.create);
router.get("/:id", suppliers.getOne);
router.patch("/:id", validate(updateSupplierSchema), suppliers.update);
router.post("/:id/deactivate", suppliers.deactivate);
router.post("/:id/reactivate", suppliers.reactivate);
router.get("/:id/payments", suppliers.payments);
router.post("/:id/payments", validate(supplierPaymentSchema), suppliers.recordPayment);
router.get("/:id/returns", suppliers.returns);
router.post("/:id/returns", validate(createSupplierReturnSchema), suppliers.recordReturn);

export default router;
