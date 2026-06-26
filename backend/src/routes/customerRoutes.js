import { Router } from "express";
import * as customers from "../controllers/customerController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerPaymentSchema,
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

export default router;
