import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export function usePurchases(filters) {
  return useQuery({
    queryKey: ["purchases", filters],
    queryFn: () => api.fetchPurchases(filters),
    placeholderData: (prev) => prev,
  });
}

export function usePurchase(id) {
  return useQuery({
    queryKey: ["purchase", id],
    queryFn: () => api.getPurchase(id),
    enabled: Boolean(id),
  });
}

export function useSuppliers(active) {
  return useQuery({
    queryKey: ["suppliers", active ?? "all"],
    queryFn: () => api.fetchSuppliers(active),
  });
}

/** Recording a purchase changes stock + avgCost (items) and balances (suppliers). */
export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createPurchase(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createSupplier(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

/** Reversing a purchase changes stock + avgCost (items) and supplier balances. */
export function useReversePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.reversePurchase(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase", id] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}

export function useSupplier(id) {
  return useQuery({
    queryKey: ["supplier", id],
    queryFn: () => api.getSupplier(id),
    enabled: Boolean(id),
  });
}

export function useSupplierPayments(id) {
  return useQuery({
    queryKey: ["supplierPayments", id],
    queryFn: () => api.fetchSupplierPayments(id),
    enabled: Boolean(id),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.updateSupplier(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier", id] });
    },
  });
}

export function useSetSupplierActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }) => api.setSupplierActive(id, active),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier", id] });
    },
  });
}

/** A payment reduces the supplier's balance owed (its own transaction). */
export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.recordSupplierPayment(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier", id] });
      qc.invalidateQueries({ queryKey: ["supplierPayments", id] });
    },
  });
}
