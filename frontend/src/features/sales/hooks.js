import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export function useCustomers(active) {
  return useQuery({
    queryKey: ["customers", active ?? "all"],
    queryFn: () => api.fetchCustomers(active),
  });
}

export function useSales(filters) {
  return useQuery({
    queryKey: ["sales", filters],
    queryFn: () => api.fetchSales(filters),
    placeholderData: (prev) => prev,
  });
}

export function useSale(id) {
  return useQuery({
    queryKey: ["sale", id],
    queryFn: () => api.getSale(id),
    enabled: Boolean(id),
  });
}

export function useSaleReturns(id) {
  return useQuery({
    queryKey: ["saleReturns", id],
    queryFn: () => api.fetchSaleReturns(id),
    enabled: Boolean(id),
  });
}

function invalidateSaleWorld(qc, id) {
  qc.invalidateQueries({ queryKey: ["items"] });
  qc.invalidateQueries({ queryKey: ["sales"] });
  qc.invalidateQueries({ queryKey: ["sale", id] });
  qc.invalidateQueries({ queryKey: ["saleReturns", id] });
  qc.invalidateQueries({ queryKey: ["customers"] });
}

/** Voiding a sale puts stock back and undoes its khata effect. */
export function useVoidSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.voidSale(id),
    onSuccess: (_data, id) => invalidateSaleWorld(qc, id),
  });
}

/** A customer return puts stock back and refunds cash / credits the khata. */
export function useRecordSaleReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.recordSaleReturn(id, body),
    onSuccess: (_data, { id }) => invalidateSaleWorld(qc, id),
  });
}

/** Recording a sale decreases stock (items) and, on credit, moves a khata (customers). */
export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createSale(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createCustomer(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}
