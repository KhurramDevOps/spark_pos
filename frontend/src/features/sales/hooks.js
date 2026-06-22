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
