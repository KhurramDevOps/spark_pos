import {
  createItem,
  updateItem,
  setItemActive,
  adjustStock,
  listItems,
  listNegativeStockItems,
  getItemOpening,
} from "../services/itemService.js";
import { recalculateItemCost, repairOpeningCost } from "../services/costService.js";
import { setUploadedImage, removeImage } from "../services/imageService.js";
import Item from "../models/Item.js";

/** Wrap an async handler so thrown/rejected errors reach the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const uploadImage = wrap(async (req, res) => {
  const item = await setUploadedImage(req.params.id, req.file);
  res.json(item);
});

export const deleteImage = wrap(async (req, res) => {
  const item = await removeImage(req.params.id);
  res.json(item);
});

export const recalculateCost = wrap(async (req, res) => {
  const result = await recalculateItemCost(req.params.id, { userId: req.userId });
  res.json(result);
});

export const repairOpening = wrap(async (req, res) => {
  const result = await repairOpeningCost(req.params.id, req.validated, { userId: req.userId });
  res.json(result);
});

export const opening = wrap(async (req, res) => {
  res.json(await getItemOpening(req.params.id));
});

export const negativeStock = wrap(async (_req, res) => {
  res.json(await listNegativeStockItems());
});

export const list = wrap(async (req, res) => {
  const { search, categoryId, active, noImage, page, limit } = req.query;
  // active: "true" | "false" | "all"/absent. Absent defaults to active-only.
  let activeFilter;
  if (active === "true") activeFilter = true;
  else if (active === "false") activeFilter = false;
  else if (active === "all") activeFilter = undefined;
  else activeFilter = true;

  const result = await listItems({
    search,
    categoryId: categoryId || undefined,
    active: activeFilter,
    noImage: noImage === "true",
    page,
    limit,
  });
  res.json(result);
});

export const getOne = wrap(async (req, res) => {
  const item = await Item.findById(req.params.id).populate("categoryId", "name skuPrefix");
  if (!item) {
    res.status(404);
    throw new Error("item not found");
  }
  res.json(item);
});

export const create = wrap(async (req, res) => {
  const { item, openingMovement } = await createItem(req.validated, { userId: req.userId });
  res.status(201).json({ item, openingMovement });
});

export const update = wrap(async (req, res) => {
  const item = await updateItem(req.params.id, req.validated, { userId: req.userId });
  res.json(item);
});

export const adjust = wrap(async (req, res) => {
  const result = await adjustStock(
    { itemId: req.params.id, ...req.validated },
    { userId: req.userId }
  );
  res.json(result);
});

export const deactivate = wrap(async (req, res) => {
  const item = await setItemActive(req.params.id, false);
  res.json(item);
});

export const reactivate = wrap(async (req, res) => {
  const item = await setItemActive(req.params.id, true);
  res.json(item);
});
