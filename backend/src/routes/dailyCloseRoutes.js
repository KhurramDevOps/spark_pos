import { Router } from "express";
import * as dailyClose from "../controllers/dailyCloseController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { saveDayCloseSchema } from "../../../shared/validation/expense.js";

const router = Router();

router.use(requireAuth, requireOwner);

router.get("/", dailyClose.get);
router.get("/lines", dailyClose.lineDetail);
router.post("/", validate(saveDayCloseSchema), dailyClose.save);

export default router;
