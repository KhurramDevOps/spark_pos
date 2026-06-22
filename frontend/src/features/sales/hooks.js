import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export function useCustomers(active) {
  return useQuery({
    queryKey: ["customers", active ?? "all"],
    queryFn: () => api.fetchCustomers(active),
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
