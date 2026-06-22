import { Router } from "express";
import * as items from "../controllers/itemController.js";
import { validate } from "../middleware/validate.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createItemSchema, updateItemSchema, adjustStockSchema } from "../../../shared/validation/item.js";

const router = Router();

router.get("/", items.list);
router.post("/", validate(createItemSchema), items.create);
router.get("/:id", items.getOne);
router.patch("/:id", validate(updateItemSchema), items.update);
router.post("/:id/adjust", validate(adjustStockSchema), items.adjust);
// Owner-only integrity repair: re-derive avgCost + stockQty from movement history.
router.post("/:id/recalculate-cost", requireOwner, items.recalculateCost);
router.post("/:id/deactivate", items.deactivate);
router.post("/:id/reactivate", items.reactivate);

export default router;
