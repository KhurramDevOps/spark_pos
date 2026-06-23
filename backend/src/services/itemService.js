import mongoose from "mongoose";
import Item from "../models/Item.js";
import Category from "../models/Category.js";
import StockMovement from "../models/StockMovement.js";
import { generateSku } from "./skuService.js";
import { deleteStoredImageIfUpload } from "./imageService.js";
import { parseDecimal, subtract, isZero, isNegative, decimalToString } from "../lib/decimal.js";

/**
 * Run `fn(session)` inside a single MongoDB transaction. Every write that
 * touches more than one collection goes through here (golden rule #3).
 */
async function runInTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Turn a Mongo duplicate-key error on `sku` into a clear domain error. */
function rethrowDuplicateSku(err, sku) {
  if (err && err.code === 11000 && /sku/i.test(JSON.stringify(err.keyPattern || err.keyValue || ""))) {
    const e = new Error(`SKU "${sku}" already exists`);
    e.status = 409;
    throw e;
  }
  throw err;
}

/**
 * Create an item. If `openingQty` > 0, writes an opening StockMovement
 * (type "adjustment", note "opening stock") in the same transaction so
 * stockQty and the movement trail never drift (spec 001 §6).
 *
 * @param {object} input
 *   name, categoryId, baseUnit, retailPrice (paisa int), wholesalePrice?,
 *   reorderLevel?, notes?, sku? (manual override), openingQty? (decimal string, >= 0)
 * @param {object} ctx - { userId } authenticated user (for audit)
 * @returns {Promise<{ item: object, openingMovement: object|null }>}
 */
export async function createItem(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  // Validate the opening quantity up front so a bad value never reaches the DB.
  const openingQty = parseDecimal(input.openingQty ?? "0", "openingQty");
  if (isNegative(openingQty)) {
    const e = new Error("openingQty cannot be negative");
    e.status = 400;
    throw e;
  }

  const manualSku = input.sku != null && String(input.sku).trim() !== "";
  const sku = manualSku ? String(input.sku).trim() : null;

  try {
    return await runInTransaction(async (session) => {
      const category = await Category.findById(input.categoryId).session(session);
      if (!category) {
        const e = new Error("category not found");
        e.status = 400;
        throw e;
      }
      if (!category.isActive) {
        const e = new Error("category is inactive");
        e.status = 400;
        throw e;
      }

      const finalSku = sku ?? (await generateSku(category.skuPrefix, session));

      const [item] = await Item.create(
        [
          {
            sku: finalSku,
            name: input.name,
            categoryId: category._id,
            baseUnit: input.baseUnit,
            retailPrice: input.retailPrice,
            wholesalePrice: input.wholesalePrice,
            reorderLevel: input.reorderLevel ?? 0,
            notes: input.notes,
            stockQty: openingQty,
            image: input.image ? { kind: "url", ref: input.image.ref, updatedAt: new Date() } : null,
          },
        ],
        { session }
      );

      let openingMovement = null;
      if (!isZero(openingQty)) {
        const [mv] = await StockMovement.create(
          [
            {
              itemId: item._id,
              qty: openingQty,
              type: "adjustment",
              note: "opening stock",
              createdBy: userId,
            },
          ],
          { session }
        );
        openingMovement = mv;
      }

      return { item, openingMovement };
    });
  } catch (err) {
    rethrowDuplicateSku(err, sku ?? "(auto)");
  }
}

/**
 * Manually adjust an item's stock to a counted absolute quantity.
 * The counted value is authoritative: the movement delta is computed from the
 * stock read *inside* the transaction (so a concurrent edit can't corrupt it),
 * stockQty is set to the counted value, and a StockMovement records the delta.
 * A zero delta is a no-op (no movement written).
 *
 * @param {object} input - { itemId, countedQty (decimal string, >= 0), note (required) }
 * @param {object} ctx - { userId }
 * @returns {Promise<{ changed: boolean, delta: string, item: object, movement: object|null }>}
 */
export async function adjustStock(input, { userId } = {}) {
  if (!userId) throw new Error("userId is required (audit)");

  const note = input.note != null ? String(input.note).trim() : "";
  if (!note) {
    const e = new Error("a reason note is required for stock adjustment");
    e.status = 400;
    throw e;
  }

  const counted = parseDecimal(input.countedQty, "countedQty");
  if (isNegative(counted)) {
    const e = new Error("countedQty cannot be negative");
    e.status = 400;
    throw e;
  }

  return runInTransaction(async (session) => {
    const item = await Item.findById(input.itemId).session(session);
    if (!item) {
      const e = new Error("item not found");
      e.status = 404;
      throw e;
    }

    const current = decimalToString(item.stockQty);
    const delta = subtract(counted, current, "countedQty", "currentStock");

    if (isZero(delta)) {
      return { changed: false, delta: "0", item, movement: null };
    }

    item.stockQty = counted;
    await item.save({ session });

    const [movement] = await StockMovement.create(
      [
        {
          itemId: item._id,
          qty: delta,
          type: "adjustment",
          note,
          createdBy: userId,
        },
      ],
      { session }
    );

    return { changed: true, delta, item, movement };
  });
}

const UPDATABLE_FIELDS = [
  "name",
  "categoryId",
  "baseUnit",
  "retailPrice",
  "wholesalePrice",
  "reorderLevel",
  "notes",
  "sku",
];

/**
 * Update an item's details. Does NOT touch stockQty (use adjustStock) or
 * isActive (use setItemActive). Enforces: baseUnit is immutable once any
 * StockMovement exists for the item; a new categoryId must be an active category.
 */
export async function updateItem(id, input, { userId } = {}) {
  const item = await Item.findById(id);
  if (!item) {
    const e = new Error("item not found");
    e.status = 404;
    throw e;
  }

  // baseUnit lock: blocked once stock has ever moved (opening stock counts).
  if (input.baseUnit !== undefined && input.baseUnit !== item.baseUnit) {
    const hasMovement = await StockMovement.exists({ itemId: item._id });
    if (hasMovement) {
      const e = new Error("baseUnit cannot be changed once stock movements exist for this item");
      e.status = 409;
      throw e;
    }
  }

  if (input.categoryId !== undefined && String(input.categoryId) !== String(item.categoryId)) {
    const category = await Category.findById(input.categoryId);
    if (!category) {
      const e = new Error("category not found");
      e.status = 400;
      throw e;
    }
    if (!category.isActive) {
      const e = new Error("category is inactive");
      e.status = 400;
      throw e;
    }
  }

  for (const field of UPDATABLE_FIELDS) {
    if (input[field] !== undefined) {
      // null clears optional fields (wholesalePrice, notes).
      item[field] = input[field] === null ? undefined : input[field];
    }
  }

  // Image set/replace via PATCH (URL kind only; uploads go through the image
  // route, removal through DELETE). Replacing an upload-backed image cleans up
  // the old file after the save succeeds.
  let previousImage;
  if (input.image !== undefined) {
    previousImage = item.image;
    item.image = { kind: "url", ref: input.image.ref, updatedAt: new Date() };
  }

  try {
    await item.save();
  } catch (err) {
    rethrowDuplicateSku(err, input.sku ?? item.sku);
  }
  if (previousImage) await deleteStoredImageIfUpload(previousImage);
  return item;
}

/** Deactivate (soft delete) or reactivate an item. Never deletes data. */
export async function setItemActive(id, isActive) {
  const item = await Item.findById(id);
  if (!item) {
    const e = new Error("item not found");
    e.status = 404;
    throw e;
  }
  item.isActive = isActive;
  await item.save();
  return item;
}

/** Escape user input for safe use inside a RegExp. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Paginated item list with case-insensitive substring search on name + sku and
 * optional category / active filters.
 * @param {object} opts - { search, categoryId, active (bool|undefined=all), page, limit }
 */
export async function listItems({ search, categoryId, active, noImage, page = 1, limit = 20 } = {}) {
  const query = {};
  if (typeof active === "boolean") query.isActive = active;
  if (categoryId) query.categoryId = categoryId;
  // Items with no image (spec 006b) — null OR missing both match `image: null`.
  if (noImage) query.image = null;
  if (search && search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    query.$or = [{ name: rx }, { sku: rx }];
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const [items, total] = await Promise.all([
    Item.find(query)
      .sort({ name: 1 })
      .collation({ locale: "en", strength: 2 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("categoryId", "name skuPrefix"),
    Item.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.ceil(total / safeLimit),
  };
}

/**
 * Items whose cached stock has gone negative (spec 001's deferred "Negative Stock"
 * view, built with sales in spec 004 — sales are what drive stock below 0). Most
 * negative first, so the worst counts surface at the top.
 */
export async function listNegativeStockItems() {
  return Item.find({ stockQty: { $lt: 0 } })
    .sort({ stockQty: 1 })
    .populate("categoryId", "name skuPrefix");
}
