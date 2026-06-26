import { useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setUnauthorizedHandler } from "../../lib/apiClient";
import { AuthContext } from "./context";
import * as api from "./api";

/**
 * Holds the current user and the auth lifecycle for the whole app (React Context,
 * not Zustand — this codebase has no Zustand store). The session lives in a
 * react-query cache under ["me"], matching how every other feature fetches.
 *
 * `status`:
 *  - "loading"        first /me in flight (don't render login OR the app yet)
 *  - "needsBootstrap" the setup gate answered 503 → no owner exists → first-run
 *  - "ready"          resolved; `user` is the logged-in user, or null if logged out
 *
 * The ["me"] query rehydrates the session on mount, so a page refresh keeps you
 * logged in (the cookie is still there) instead of bouncing to login.
 */
export function AuthProvider({ children }) {
  const qc = useQueryClient();

  const { data, error, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.fetchMe,
    retry: false, // a 401/503 is an answer, not a transient failure — don't retry
    staleTime: Infinity,
  });

  useEffect(() => {
    // Any 401 from ANY api call clears the cached session so the app falls back to
    // login. The server guards (slice 7) are the real boundary; this just stops a
    // revoked/expired session lingering on a screen it can no longer load.
    setUnauthorizedHandler(() => qc.setQueryData(["me"], null));
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const user = data?.user ?? null;
  // A 503 means the setup gate is open (no owner yet) → first-run bootstrap. Any
  // other error (typically 401) is just "logged out".
  const status = isLoading ? "loading" : error?.status === 503 ? "needsBootstrap" : "ready";

  const login = useCallback(
    async (username, password) => {
      const res = await api.login({ username, password });
      qc.setQueryData(["me"], res); // { user }
      return res.user;
    },
    [qc]
  );

  const bootstrap = useCallback(
    async (username, password) => {
      const res = await api.bootstrap({ username, password }); // { user, migrated }
      qc.setQueryData(["me"], { user: res.user });
      return res.user;
    },
    [qc]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      qc.setQueryData(["me"], null);
      // Drop the previous user's cached data so the next user (shared shop
      // terminal) never sees it. Leave ["me"] as the null we just set.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    }
  }, [qc]);

  const value = {
    user,
    status,
    isOwner: user?.role === "owner",
    login,
    logout,
    bootstrap,
    refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
