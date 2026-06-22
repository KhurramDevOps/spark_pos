import { apiClient } from "../../lib/apiClient";

// body: { date?, customerId?, paymentType, priceMode, lines:[{ itemId, qty, unitPrice(rupees) }], note? }
export const createSale = (body) => apiClient.post("/sales", body);

export function fetchSales({ customerId, from, to, paymentType, page, limit } = {}) {
  const params = new URLSearchParams();
  if (customerId) params.set("customerId", customerId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (paymentType) params.set("paymentType", paymentType);
  if (page) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiClient.get(`/sales${qs ? `?${qs}` : ""}`);
}

export const getSale = (id) => apiClient.get(`/sales/${id}`);

export const fetchCustomers = (active) =>
  apiClient.get(`/customers${active ? `?active=${active}` : ""}`);
export const createCustomer = (body) => apiClient.post("/customers", body);
