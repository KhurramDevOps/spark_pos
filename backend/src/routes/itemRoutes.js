import { Router } from "express";
import multer from "multer";
import * as items from "../controllers/itemController.js";
import { validate } from "../middleware/validate.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { createItemSchema, updateItemSchema, adjustStockSchema, repairOpeningCostSchema } from "../../../shared/validation/item.js";

const router = Router();

// In-memory multipart for image uploads (spec 006b). 10 MB cap at the boundary;
// Sharp resizes the buffer in the service. Multer errors → 400 with a clear message.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const handleUpload = (req, res, next) =>
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    res.status(400);
    next(new Error(err.code === "LIMIT_FILE_SIZE" ? "file too large (max 10 MB)" : err.message));
  });

router.get("/", items.list);
// Literal path before "/:id" so it isn't captured as an id.
router.get("/negative-stock", items.negativeStock);
router.post("/", validate(createItemSchema), items.create);
router.get("/:id", items.getOne);
// Current opening declaration (spec 006c §9.5) — feeds the Edit-Item repair panel.
router.get("/:id/opening", items.opening);
router.patch("/:id", validate(updateItemSchema), items.update);
router.post("/:id/adjust", validate(adjustStockSchema), items.adjust);
// Owner-only integrity repair: re-derive avgCost + stockQty from movement history.
router.post("/:id/recalculate-cost", requireOwner, items.recalculateCost);
// Owner-only: declare/repair the correct opening cost (spec 006c §4 path #4).
router.post("/:id/repair-opening-cost", requireOwner, validate(repairOpeningCostSchema), items.repairOpening);
router.post("/:id/deactivate", items.deactivate);
router.post("/:id/reactivate", items.reactivate);
// Image (spec 006b): upload (multipart) + remove. Owner-only; URL set is via PATCH.
router.post("/:id/image", requireOwner, handleUpload, items.uploadImage);
router.delete("/:id/image", requireOwner, items.deleteImage);

export default router;
