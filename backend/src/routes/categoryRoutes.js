import { Router } from "express";
import * as categories from "../controllers/categoryController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createCategorySchema } from "../../../shared/validation/category.js";

const router = Router();

router.get("/", requireAuth, categories.list);
router.post("/", requireAuth, requireOwner, validate(createCategorySchema), categories.create);
router.post("/:id/deactivate", requireAuth, requireOwner, categories.deactivate);
router.post("/:id/reactivate", requireAuth, requireOwner, categories.reactivate);

export default router;
