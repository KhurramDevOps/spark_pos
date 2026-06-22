import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export function usePurchases(filters) {
  return useQuery({
    queryKey: ["purchases", filters],
    queryFn: () => api.fetchPurchases(filters),
    placeholderData: (prev) => prev,
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
