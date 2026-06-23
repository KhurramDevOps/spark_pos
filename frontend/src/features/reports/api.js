import { apiClient } from "../../lib/apiClient";

// Reports — one read-only round-trip per window (spec 006). All money in the
// response is paisa strings; format at the UI boundary with formatPaisa.
// params: { window, start?, end? } — start/end are YYYY-MM-DD, custom only.
export function getReport({ window, start, end }) {
  const p = new URLSearchParams({ window });
  if (window === "custom") {
    if (start) p.set("start", start);
    if (end) p.set("end", end);
  }
  return apiClient.get(`/reports?${p.toString()}`);
}
