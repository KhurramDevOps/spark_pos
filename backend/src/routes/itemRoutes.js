import { Router } from "express";
import multer from "multer";
import * as items from "../controllers/itemController.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
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

router.get("/", requireAuth, items.list);
// Literal path before "/:id" so it isn't captured as an id.
router.get("/negative-stock", requireAuth, requireOwner, items.negativeStock);
router.post("/", requireAuth, requireOwner, validate(createItemSchema), items.create);
router.get("/:id", requireAuth, items.getOne);
// Current opening declaration (spec 006c §9.5) — feeds the Edit-Item repair panel.
router.get("/:id/opening", requireAuth, items.opening);
router.patch("/:id", requireAuth, requireOwner, validate(updateItemSchema), items.update);
router.post("/:id/adjust", requireAuth, requireOwner, validate(adjustStockSchema), items.adjust);
// Owner-only integrity repair: re-derive avgCost + stockQty from movement history.
router.post("/:id/recalculate-cost", requireAuth, requireOwner, items.recalculateCost);
// Owner-only: declare/repair the correct opening cost (spec 006c §4 path #4).
router.post("/:id/repair-opening-cost", requireAuth, requireOwner, validate(repairOpeningCostSchema), items.repairOpening);
router.post("/:id/deactivate", requireAuth, requireOwner, items.deactivate);
router.post("/:id/reactivate", requireAuth, requireOwner, items.reactivate);
// Image (spec 006b): upload (multipart) + remove. Owner-only; URL set is via PATCH.
router.post("/:id/image", requireAuth, requireOwner, handleUpload, items.uploadImage);
router.delete("/:id/image", requireAuth, requireOwner, items.deleteImage);

export default router;
