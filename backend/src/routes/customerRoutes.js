import { Router } from "express";
import * as customers from "../controllers/customerController.js";
import { validate } from "../middleware/validate.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerPaymentSchema,
} from "../../../shared/validation/customer.js";

const router = Router();

router.get("/", customers.list);
router.post("/", validate(createCustomerSchema), customers.create);
router.get("/:id", customers.getOne);
router.patch("/:id", validate(updateCustomerSchema), customers.update);
router.post("/:id/deactivate", customers.deactivate);
router.post("/:id/reactivate", customers.reactivate);
router.get("/:id/payments", customers.payments);
router.post("/:id/payments", validate(customerPaymentSchema), customers.recordPayment);

export default router;
