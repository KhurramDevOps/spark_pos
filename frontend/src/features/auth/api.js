import { apiClient } from "../../lib/apiClient";

// ---- Session / own account (spec 007) -------------------------------------

export const fetchMe = () => apiClient.get("/auth/me");
export const login = (body) => apiClient.post("/auth/login", body);
export const logout = () => apiClient.post("/auth/logout");
export const bootstrap = (body) => apiClient.post("/auth/bootstrap", body);
export const changePassword = (body) => apiClient.post("/auth/change-password", body);

// ---- Owner-only user management -------------------------------------------

export const fetchUsers = () => apiClient.get("/users");
export const createWorker = (body) => apiClient.post("/users", body);
export const deactivateUser = (id) => apiClient.post(`/users/${id}/deactivate`);
export const resetUserPassword = (id, body) => apiClient.post(`/users/${id}/reset-password`, body);
