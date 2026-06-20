import { Router } from "express";
import * as categories from "../controllers/categoryController.js";
import { validate } from "../middleware/validate.js";
import { createCategorySchema } from "../../../shared/validation/category.js";

const router = Router();

router.get("/", categories.list);
router.post("/", validate(createCategorySchema), categories.create);
router.post("/:id/deactivate", categories.deactivate);
router.post("/:id/reactivate", categories.reactivate);

export default router;
