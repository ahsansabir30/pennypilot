import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const themeStorageKey = "pennypilot-theme";
const darkQuery = "(prefers-color-scheme: dark)";
const themeColours: Record<Theme, string> = { light: "#f6f7f3", dark: "#111815" };

export function readThemePreference(): ThemePreference {
  const session = document.documentElement.dataset.themePreference;
  if (session === "light" || session === "dark") return session;
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    console.warn("Theme preference storage is unavailable; using the system theme.");
    return "system";
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia(darkQuery).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColours[theme]);
}

function saveThemePreference(theme: Theme) {
  document.documentElement.dataset.themePreference = theme;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
    return true;
  } catch {
    console.warn("Theme preference could not be saved; it applies only to this session.");
    return false;
  }
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(preference));
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(darkQuery);
    const follow = () => setTheme(query.matches ? "dark" : "light");
    follow();
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [preference]);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStorageError(saveThemePreference(next) ? "" : "Theme changed for this session only. Your preference could not be saved.");
    setPreference(next);
    setTheme(next);
  }

  return { theme, toggleTheme, storageError };
}
