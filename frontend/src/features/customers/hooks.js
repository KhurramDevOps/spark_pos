import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export function useCustomers(active) {
  return useQuery({
    queryKey: ["customers", active ?? "all"],
    queryFn: () => api.fetchCustomers(active),
  });
}

export function useCustomer(id) {
  return useQuery({
    queryKey: ["customer", id],
    queryFn: () => api.getCustomer(id),
    enabled: Boolean(id),
  });
}

export function useCustomerPayments(id) {
  return useQuery({
    queryKey: ["customerPayments", id],
    queryFn: () => api.fetchCustomerPayments(id),
    enabled: Boolean(id),
  });
}

// Only CREDIT sales belong in a khata ledger — a cash sale is settled on the spot
// and never touches udhaar. Keyed under ["sales", ...] so a new sale (which
// invalidates ["sales"]) refreshes it.
export function useCustomerCreditSales(id) {
  return useQuery({
    queryKey: ["sales", { customerId: id, paymentType: "credit" }],
    queryFn: () => api.fetchSales({ customerId: id, paymentType: "credit", limit: 100 }),
    enabled: Boolean(id),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createCustomer(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.updateCustomer(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer", id] });
    },
  });
}

export function useSetCustomerActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }) => api.setCustomerActive(id, active),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer", id] });
    },
  });
}

/** A payment received reduces the customer's khata balance (its own transaction). */
export function useRecordCustomerPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.recordCustomerPayment(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer", id] });
      qc.invalidateQueries({ queryKey: ["customerPayments", id] });
    },
  });
}
