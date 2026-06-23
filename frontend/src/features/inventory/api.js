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

// ---- Item image (spec 006b) ----------------------------------------------

// Multipart upload — raw fetch so the browser sets the multipart boundary
// (apiClient forces application/json, which would break the upload).
export async function uploadItemImage(id, file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/items/${id}/image`, { method: "POST", body: fd });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
  return data;
}
export const deleteItemImage = (id) => apiClient.del(`/items/${id}/image`);
export const adjustStock = (id, body) => apiClient.post(`/items/${id}/adjust`, body);
export const deactivateItem = (id) => apiClient.post(`/items/${id}/deactivate`, {});
export const reactivateItem = (id) => apiClient.post(`/items/${id}/reactivate`, {});
// Owner-only: re-derive avgCost + stockQty from movement history (spec 003b repair).
export const recalculateCost = (id) => apiClient.post(`/items/${id}/recalculate-cost`, {});
// Items whose cached stock has gone negative (spec 004 Negative Stock view).
export const fetchNegativeStockItems = () => apiClient.get("/items/negative-stock");

// ---- Categories -----------------------------------------------------------

export const fetchCategories = (active) =>
  apiClient.get(`/categories${active ? `?active=${active}` : ""}`);
export const createCategory = (body) => apiClient.post("/categories", body);
export const deactivateCategory = (id) => apiClient.post(`/categories/${id}/deactivate`, {});
export const reactivateCategory = (id) => apiClient.post(`/categories/${id}/reactivate`, {});
