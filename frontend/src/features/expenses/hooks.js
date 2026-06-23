import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

// The daily-close view is a read-mostly aggregation pulled fresh from immutable
// sources (spec 005 §6). Any write that touches the day's cash math — an
// expense, a drawer adjustment, a saved close — invalidates ["dailyClose"] so
// the screen re-reads. We invalidate the whole ["dailyClose"] family rather than
// a single date because a write can affect a past day too.

export function useDailyClose(date) {
  return useQuery({
    queryKey: ["dailyClose", date ?? "today"],
    queryFn: () => api.getDailyClose(date),
  });
}

export function useDailyCloseLine(date, line, enabled) {
  return useQuery({
    queryKey: ["dailyCloseLine", date ?? "today", line],
    queryFn: () => api.getDailyCloseLine(date, line),
    enabled: Boolean(enabled),
  });
}

export function useExpenses() {
  return useQuery({
    queryKey: ["expenses"],
    queryFn: () => api.fetchExpenses(),
  });
}

export function useDrawerAdjustments() {
  return useQuery({
    queryKey: ["drawerAdjustments"],
    queryFn: () => api.fetchDrawerAdjustments(),
  });
}

function invalidateDayMath(qc) {
  qc.invalidateQueries({ queryKey: ["dailyClose"] });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createExpense(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      invalidateDayMath(qc);
    },
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.updateExpense(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      invalidateDayMath(qc);
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteExpense(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      invalidateDayMath(qc);
    },
  });
}

export function useCreateDrawerAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createDrawerAdjustment(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drawerAdjustments"] });
      invalidateDayMath(qc);
    },
  });
}

export function useSaveDailyClose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.saveDailyClose(body),
    onSuccess: () => invalidateDayMath(qc),
  });
}
