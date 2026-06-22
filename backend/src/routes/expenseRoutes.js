import { Router } from "express";
import * as expenses from "../controllers/expenseController.js";
import { validate } from "../middleware/validate.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createExpenseSchema, updateExpenseSchema } from "../../../shared/validation/expense.js";

const router = Router();

// Owner-only (spec 005 §6).
router.get("/", requireOwner, expenses.list);
router.post("/", requireOwner, validate(createExpenseSchema), expenses.create);
router.patch("/:id", requireOwner, validate(updateExpenseSchema), expenses.update);
router.delete("/:id", requireOwner, expenses.remove);

export default router;
