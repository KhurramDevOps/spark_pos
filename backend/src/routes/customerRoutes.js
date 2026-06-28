import { Router } from "express";
import * as customers from "../controllers/customerController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerPaymentSchema,
  customerAdjustmentSchema,
} from "../../../shared/validation/customer.js";

const router = Router();

router.get("/", requireAuth, customers.list);
router.post("/", requireAuth, validate(createCustomerSchema), customers.create);
router.get("/:id", requireAuth, customers.getOne);
router.patch("/:id", requireAuth, requireOwner, validate(updateCustomerSchema), customers.update);
router.post("/:id/deactivate", requireAuth, requireOwner, customers.deactivate);
router.post("/:id/reactivate", requireAuth, requireOwner, customers.reactivate);
router.get("/:id/payments", requireAuth, customers.payments);
router.post("/:id/payments", requireAuth, validate(customerPaymentSchema), customers.recordPayment);
// Khata balance corrections (spec 010). View is auth'd (in the ledger); recording is
// owner-only — a sensitive correction, not a routine entry.
router.get("/:id/adjustments", requireAuth, customers.adjustments);
router.post("/:id/adjustments", requireAuth, requireOwner, validate(customerAdjustmentSchema), customers.recordAdjustment);

export default router;
