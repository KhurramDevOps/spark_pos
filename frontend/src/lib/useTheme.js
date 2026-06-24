import { useSyncExternalStore } from "react";

// Single source of truth for the active theme: the `dark` class on <html>
// (set pre-paint by the inline script in index.html, then toggled here). The
// manual choice persists to localStorage and always overrides system preference.

const isDark = () => document.documentElement.classList.contains("dark");
const currentTheme = () => (isDark() ? "dark" : "light");

const listeners = new Set();
const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function setTheme(mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem("theme", mode);
  } catch (e) {
    /* private mode / storage disabled — toggle still works for this session */
  }
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(isDark() ? "light" : "dark");
}

/** Reactive theme for components (e.g. charts that need theme-aware colours). */
export function useTheme() {
  return useSyncExternalStore(subscribe, currentTheme, () => "light");
}
