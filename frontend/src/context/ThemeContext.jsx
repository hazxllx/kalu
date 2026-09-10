import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Application-wide theme (Light / Dark / System).
 *
 * LIGHT is the default. A user's explicit selection (Light, Dark or System) is
 * persisted in localStorage and applied to the root `<html>` element via the
 * `dark` class (tailwind `darkMode: ["class"]`).
 *
 * "System" is an OPT-IN behavior that follows the OS preference and reacts to
 * changes live. Users with no saved preference always get Light Mode — the
 * browser's preferred-color-scheme is never used unless the user chooses
 * "System".
 *
 * An inline script in `index.html` applies the saved theme before first paint
 * to prevent any light→dark flash or wrong-theme flicker.
 */

const STORAGE_KEY = "kalusagap.theme";

const getInitialTheme = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* ignore */
  }
  // Default: Light Mode. Never fall back to the OS preference automatically.
  return "light";
};

const systemPrefersDark = () =>
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

const resolveTheme = (theme) => (theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme);

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(getInitialTheme);
  const [resolved, setResolved] = useState(() => resolveTheme(getInitialTheme()));

  useEffect(() => {
    setResolved(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (resolved === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [resolved]);

  // Live-follow system preference when the user chooses "System".
  useEffect(() => {
    if (theme !== "system") return undefined;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(mql.matches ? "dark" : "light");
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, [theme]);

  const setTheme = useCallback((value) => {
    setThemeState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
};

export default ThemeContext;
