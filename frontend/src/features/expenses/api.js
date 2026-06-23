import { apiClient } from "../../lib/apiClient";

// Spec 005 — Expenses, drawer adjustments, daily close. All owner-only on the
// backend. Money goes UP as a rupees string; the server converts to paisa at
// the boundary (shared/validation/money.js). Money comes DOWN as paisa strings.

// ---- Expenses -------------------------------------------------------------

export const fetchExpenses = () => apiClient.get("/expenses");
// body: { category, amount(rupees), date?, note? }
export const createExpense = (body) => apiClient.post("/expenses", body);
export const updateExpense = (id, body) => apiClient.patch(`/expenses/${id}`, body);
export const deleteExpense = (id) => apiClient.del(`/expenses/${id}`);

// ---- Drawer adjustments ---------------------------------------------------

export const fetchDrawerAdjustments = () => apiClient.get("/drawer-adjustments");
// body: { direction('in'|'out'), amount(rupees), date?, note? }
export const createDrawerAdjustment = (body) =>
  apiClient.post("/drawer-adjustments", body);

// ---- Daily close ----------------------------------------------------------

// date is an Asia/Karachi 'YYYY-MM-DD' string (omit for today).
export const getDailyClose = (date) =>
  apiClient.get(`/daily-close${date ? `?date=${date}` : ""}`);
// body: { date('YYYY-MM-DD'), actualCash(rupees), note? }
export const saveDailyClose = (body) => apiClient.post("/daily-close", body);
