import { useQuery, keepPreviousData } from "@tanstack/react-query";
import * as api from "./api";

/** One report per window. Custom waits until both dates are set. Keeps the prior
 *  window's data on screen while the next loads (no flicker switching windows). */
export function useReport(params) {
  return useQuery({
    queryKey: ["report", params],
    queryFn: () => api.getReport(params),
    enabled: params.window !== "custom" || Boolean(params.start && params.end),
    placeholderData: keepPreviousData,
  });
}
