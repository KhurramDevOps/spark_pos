import { apiClient } from "../../lib/apiClient";

// body: { date?, customerId?, paymentType, priceMode, lines:[{ itemId, qty, unitPrice(rupees) }], note? }
export const createSale = (body) => apiClient.post("/sales", body);

export const fetchCustomers = (active) =>
  apiClient.get(`/customers${active ? `?active=${active}` : ""}`);
export const createCustomer = (body) => apiClient.post("/customers", body);
