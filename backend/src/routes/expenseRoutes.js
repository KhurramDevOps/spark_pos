import { Router } from "express";
import * as expenses from "../controllers/expenseController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createExpenseSchema, updateExpenseSchema } from "../../../shared/validation/expense.js";

const router = Router();

// Owner-only (spec 005 §6) — uniform file, guarded at the router level.
router.use(requireAuth, requireOwner);

router.get("/", expenses.list);
router.post("/", validate(createExpenseSchema), expenses.create);
router.patch("/:id", validate(updateExpenseSchema), expenses.update);
router.delete("/:id", expenses.remove);

export default router;
