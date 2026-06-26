import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: api.fetchUsers });
}

export function useCreateWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createWorker(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deactivateUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }) => api.resetUserPassword(id, { newPassword }),
  });
}
