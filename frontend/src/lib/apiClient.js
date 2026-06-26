// Thin fetch wrapper around the backend API. All calls go through /api on the
// same origin — the Vite proxy in dev, the SPA-serving Express in prod — so the
// SameSite=Strict session cookie rides along and no CORS/base URL is needed.

// AuthContext registers a handler here so that ANY 401 (expired / revoked /
// deactivated session) clears auth and drops the app back to login. This is UX
// convenience — the server guards (slice 7) are the real boundary.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    const message = data?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const apiClient = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  patch: (path, body) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),
};
