import { apiClient } from "../../lib/apiClient";

// ---- Customers (mirror of the supplier api) -------------------------------

export const fetchCustomers = (active, search) => {
  const params = new URLSearchParams();
  if (active) params.set("active", active);
  if (search && search.trim()) params.set("search", search.trim());
  const qs = params.toString();
  return apiClient.get(`/customers${qs ? `?${qs}` : ""}`);
};
export const getCustomer = (id) => apiClient.get(`/customers/${id}`);
export const createCustomer = (body) => apiClient.post("/customers", body);
export const updateCustomer = (id, body) => apiClient.patch(`/customers/${id}`, body);
export const setCustomerActive = (id, active) =>
  apiClient.post(`/customers/${id}/${active ? "reactivate" : "deactivate"}`);

// ---- Customer payments ----------------------------------------------------

export const fetchCustomerPayments = (id) => apiClient.get(`/customers/${id}/payments`);
// body: { amount(rupees), date?, note? }
export const recordCustomerPayment = (id, body) =>
  apiClient.post(`/customers/${id}/payments`, body);

// ---- Sales (for the khata ledger) -----------------------------------------

export function fetchSales({ customerId, paymentType, limit } = {}) {
  const params = new URLSearchParams();
  if (customerId) params.set("customerId", customerId);
  if (paymentType) params.set("paymentType", paymentType);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiClient.get(`/sales${qs ? `?${qs}` : ""}`);
}
