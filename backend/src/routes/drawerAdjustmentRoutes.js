import { Router } from "express";
import * as expenses from "../controllers/expenseController.js";
import { validate } from "../middleware/validate.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createDrawerAdjustmentSchema } from "../../../shared/validation/expense.js";

const router = Router();

router.get("/", requireOwner, expenses.listDrawer);
router.post("/", requireOwner, validate(createDrawerAdjustmentSchema), expenses.createDrawer);

export default router;
