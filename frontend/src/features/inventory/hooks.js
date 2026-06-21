import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import * as importApi from "./importApi";

export function useItems(filters) {
  return useQuery({
    queryKey: ["items", filters],
    queryFn: () => api.fetchItems(filters),
    placeholderData: (prev) => prev, // keep previous page visible while fetching
  });
}

export function useCategories(active) {
  return useQuery({
    queryKey: ["categories", active ?? "all"],
    queryFn: () => api.fetchCategories(active),
  });
}

/** Wrap a mutation so it invalidates items (and optionally categories) on success. */
function useInvalidatingMutation(mutationFn, { categories = false } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      if (categories) qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export const useCreateItem = () => useInvalidatingMutation((body) => api.createItem(body));
export const useUpdateItem = () =>
  useInvalidatingMutation(({ id, body }) => api.updateItem(id, body));
export const useAdjustStock = () =>
  useInvalidatingMutation(({ id, body }) => api.adjustStock(id, body));
export const useDeactivateItem = () => useInvalidatingMutation((id) => api.deactivateItem(id));
export const useReactivateItem = () => useInvalidatingMutation((id) => api.reactivateItem(id));

// ---- CSV import -----------------------------------------------------------

/** Dry-run preview — no cache invalidation (nothing is written yet). */
export const usePreviewImport = () =>
  useMutation({ mutationFn: ({ text, filename }) => importApi.previewImport(text, filename) });

/** Commit — creates items + categories, so refresh both lists. */
export const useCommitImport = () =>
  useInvalidatingMutation((token) => importApi.commitImport(token), { categories: true });

export const useCreateCategory = () =>
  useInvalidatingMutation((body) => api.createCategory(body), { categories: true });
export const useDeactivateCategory = () =>
  useInvalidatingMutation((id) => api.deactivateCategory(id), { categories: true });
export const useReactivateCategory = () =>
  useInvalidatingMutation((id) => api.reactivateCategory(id), { categories: true });
