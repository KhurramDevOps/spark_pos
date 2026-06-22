import { apiClient } from "../../lib/apiClient";

// ---- Items ----------------------------------------------------------------

export function fetchItems({ search, categoryId, active, page, limit }) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (categoryId) params.set("categoryId", categoryId);
  if (active) params.set("active", active); // "true" | "false" | "all"
  if (page) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiClient.get(`/items${qs ? `?${qs}` : ""}`);
}

export const createItem = (body) => apiClient.post("/items", body);
export const updateItem = (id, body) => apiClient.patch(`/items/${id}`, body);
export const adjustStock = (id, body) => apiClient.post(`/items/${id}/adjust`, body);
export const deactivateItem = (id) => apiClient.post(`/items/${id}/deactivate`, {});
export const reactivateItem = (id) => apiClient.post(`/items/${id}/reactivate`, {});
// Owner-only: re-derive avgCost + stockQty from movement history (spec 003b repair).
export const recalculateCost = (id) => apiClient.post(`/items/${id}/recalculate-cost`, {});

// ---- Categories -----------------------------------------------------------

export const fetchCategories = (active) =>
  apiClient.get(`/categories${active ? `?active=${active}` : ""}`);
export const createCategory = (body) => apiClient.post("/categories", body);
export const deactivateCategory = (id) => apiClient.post(`/categories/${id}/deactivate`, {});
export const reactivateCategory = (id) => apiClient.post(`/categories/${id}/reactivate`, {});
