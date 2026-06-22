import { apiClient } from "../../lib/apiClient";

// ---- Purchases ------------------------------------------------------------

export function fetchPurchases({ supplierId, from, to, page, limit } = {}) {
  const params = new URLSearchParams();
  if (supplierId) params.set("supplierId", supplierId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (page) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiClient.get(`/purchases${qs ? `?${qs}` : ""}`);
}

export const getPurchase = (id) => apiClient.get(`/purchases/${id}`);
// body: { date?, supplierId?, paymentType, lines:[{ itemId, qty, unitCost(rupees) }], note? }
export const createPurchase = (body) => apiClient.post("/purchases", body);

// ---- Suppliers ------------------------------------------------------------

export const fetchSuppliers = (active) =>
  apiClient.get(`/suppliers${active ? `?active=${active}` : ""}`);
export const getSupplier = (id) => apiClient.get(`/suppliers/${id}`);
export const createSupplier = (body) => apiClient.post("/suppliers", body);
export const updateSupplier = (id, body) => apiClient.patch(`/suppliers/${id}`, body);
export const setSupplierActive = (id, active) =>
  apiClient.post(`/suppliers/${id}/${active ? "reactivate" : "deactivate"}`);

// ---- Supplier payments ----------------------------------------------------

export const fetchSupplierPayments = (id) => apiClient.get(`/suppliers/${id}/payments`);
// body: { amount(rupees), date?, note? }
export const recordSupplierPayment = (id, body) =>
  apiClient.post(`/suppliers/${id}/payments`, body);
