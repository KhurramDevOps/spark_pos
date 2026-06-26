import { Router } from "express";
import * as expenses from "../controllers/expenseController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createDrawerAdjustmentSchema } from "../../../shared/validation/expense.js";

const router = Router();

router.use(requireAuth, requireOwner);

router.get("/", expenses.listDrawer);
router.post("/", validate(createDrawerAdjustmentSchema), expenses.createDrawer);

export default router;
