import mongoose from "mongoose";
import Item from "../models/Item.js";
import Category from "../models/Category.js";
import StockMovement from "../models/StockMovement.js";
import { generateSku } from "./skuService.js";
import { deleteStoredImageIfUpload } from "./imageService.js";
import { parseDecimal, subtract, isZero, isNegative, decimalToString, toDecimal128 } from "../lib/decimal.js";
import { rankItemMatches } from "../lib/itemSearch.js";

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

  // Opening cost (spec 006c). When provided, the item is DECLARED with its real
  // per-unit cost: a cost-bearing `opening` movement (ADR-013), not the legacy
  // cost-less `adjustment`. costAtTime is paisa (decimal string), >= 0.
  const hasOpeningCost = input.openingUnitCost != null && String(input.openingUnitCost) !== "";
  let openingUnitCost = null;
  if (hasOpeningCost) {
    openingUnitCost = parseDecimal(input.openingUnitCost, "openingUnitCost");
    if (isNegative(openingUnitCost)) {
      const e = new Error("openingUnitCost cannot be negative");
      e.status = 400;
      throw e;
    }
    if (isZero(openingQty)) {
      const e = new Error("openingUnitCost requires a positive openingQty");
      e.status = 400;
      throw e;
    }
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
            // A declared opening sets avgCost immediately; otherwise default 0.
            ...(hasOpeningCost ? { avgCost: toDecimal128(openingUnitCost) } : {}),
            image: input.image ? { kind: "url", ref: input.image.ref, updatedAt: new Date() } : null,
          },
        ],
        { session }
      );

      let openingMovement = null;
      if (!isZero(openingQty)) {
        // With a declared cost → a cost-bearing `opening` movement (the replay
        // averages it, ADR-013). Without → the legacy cost-less qty-only path
        // (user-facing create/CSV require the cost via validation; this branch
        // remains for internal/direct callers).
        const [mv] = await StockMovement.create(
          [
            hasOpeningCost
              ? {
                  itemId: item._id,
                  qty: openingQty,
                  type: "opening",
                  costAtTime: openingUnitCost,
                  note: input.note ?? "opening stock",
                  createdBy: userId,
                }
              : {
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
 * Read the item's current opening declaration for display (spec 006c §9.5).
 * Surfaces BOTH shapes so an item that most needs repair doesn't look empty:
 *   - the cost-bearing `type: 'opening'` movement (post-006c), and
 *   - the legacy cost-less `adjustment` noted "opening stock" (pre-006c).
 * There is at most one by construction; returns the earliest if (improbably) both.
 *
 * @param {string} itemId
 * @returns {Promise<{ opening: null | { qty, unitCost: string|null, date, legacy: boolean } }>}
 */
export async function getItemOpening(itemId) {
  const mv = await StockMovement.findOne({
    itemId,
    $or: [{ type: "opening" }, { type: "adjustment", note: "opening stock" }],
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  if (!mv) return { opening: null };
  return {
    opening: {
      qty: decimalToString(mv.qty),
      // Legacy adjustments carry no cost — that's exactly why they need repairing.
      unitCost: mv.costAtTime != null ? decimalToString(mv.costAtTime) : null,
      date: mv.createdAt,
      legacy: mv.type === "adjustment",
    },
  };
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
 * Relevance-ranked, category-aware item search for the POS picker. Unlike the
 * Inventory grid (`listItems`, alphabetical + paginated), this returns the few
 * MOST RELEVANT active items for a short, loose query — matching on name, sku, AND
 * category name, with name relevance ranked above category above sku (see
 * lib/itemSearch.js). At this shop's volume (~200 items) loading the active set and
 * ranking in memory is trivially fast and keeps the ranking honest (ADR-011 spirit:
 * compute on read, no denormalized search index to drift).
 * @param {object} opts - { query (string), limit (default 8, max 25) }
 */
export async function searchItems({ query, limit = 8 } = {}) {
  if (!query || !query.trim()) return { items: [] };
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 25);
  const active = await Item.find({ isActive: true })
    .collation({ locale: "en", strength: 2 })
    .populate("categoryId", "name skuPrefix");
  return { items: rankItemMatches(active, query, safeLimit) };
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
