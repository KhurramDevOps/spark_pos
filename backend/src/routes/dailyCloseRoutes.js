import { Router } from "express";
import * as dailyClose from "../controllers/dailyCloseController.js";
import { validate } from "../middleware/validate.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { saveDayCloseSchema } from "../../../shared/validation/expense.js";

const router = Router();

router.get("/", requireOwner, dailyClose.get);
router.post("/", requireOwner, validate(saveDayCloseSchema), dailyClose.save);

export default router;
