import {
  createCategory,
  listCategories,
  setCategoryActive,
} from "../services/categoryService.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const list = wrap(async (req, res) => {
  const { active } = req.query;
  let activeFilter;
  if (active === "true") activeFilter = true;
  else if (active === "false") activeFilter = false;
  // default (absent/"all"): return all categories
  const categories = await listCategories({ active: activeFilter });
  res.json(categories);
});

export const create = wrap(async (req, res) => {
  const category = await createCategory(req.validated);
  res.status(201).json(category);
});

export const deactivate = wrap(async (req, res) => {
  const category = await setCategoryActive(req.params.id, false);
  res.json(category);
});

export const reactivate = wrap(async (req, res) => {
  const category = await setCategoryActive(req.params.id, true);
  res.json(category);
});
