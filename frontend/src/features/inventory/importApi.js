import { apiClient } from "../../lib/apiClient";

// CSV bulk import (spec 002). Preview uploads the file as raw text/csv (the
// JSON-only apiClient can't do that), so it uses fetch directly. Commit is a
// small JSON body, so it reuses apiClient.

/** POST the raw CSV text and get back the dry-run preview + import token. */
export async function previewImport(text, filename) {
  const res = await fetch("/api/imports/preview", {
    method: "POST",
    headers: {
      "Content-Type": "text/csv",
      ...(filename ? { "X-Filename": filename } : {}),
    },
    body: text,
  });
  const body = await res.text();
  const data = body ? JSON.parse(body) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Commit a previewed upload by its token. */
export const commitImport = (token) => apiClient.post("/imports/commit", { token });

/** URL of the template CSV (served as a download by the backend). */
export const TEMPLATE_URL = "/api/imports/template";
