import Category from "../models/Category.js";
import Item from "../models/Item.js";

/** Derive a 3–4 char uppercase SKU prefix from a category name. */
export function deriveSkuPrefix(name) {
  const alpha = String(name).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!alpha) return "GEN";
  return alpha.slice(0, 4).padEnd(3, "X");
}

/** Turn a duplicate-key error on name into a clear domain error. */
function rethrowDuplicateName(err, name) {
  if (err && err.code === 11000) {
    const e = new Error(`category "${name}" already exists`);
    e.status = 409;
    throw e;
  }
  throw err;
}

export async function createCategory({ name, skuPrefix }) {
  const prefix = (skuPrefix && skuPrefix.trim()) || deriveSkuPrefix(name);
  try {
    return await Category.create({ name, skuPrefix: prefix });
  } catch (err) {
    rethrowDuplicateName(err, name);
  }
}

/** List categories, optionally filtered by active state; sorted by name. */
export async function listCategories({ active } = {}) {
  const query = {};
  if (typeof active === "boolean") query.isActive = active;
  return Category.find(query).sort({ name: 1 }).collation({ locale: "en", strength: 2 });
}

/**
 * Deactivate or reactivate a category. Deactivation is BLOCKED while any active
 * item still references it (spec 001 §6). Reactivation is always allowed.
 */
export async function setCategoryActive(id, isActive) {
  const category = await Category.findById(id);
  if (!category) {
    const e = new Error("category not found");
    e.status = 404;
    throw e;
  }

  if (!isActive) {
    const blocking = await Item.exists({ categoryId: id, isActive: true });
    if (blocking) {
      const e = new Error("cannot deactivate a category while active items reference it");
      e.status = 409;
      throw e;
    }
  }

  category.isActive = isActive;
  await category.save();
  return category;
}
