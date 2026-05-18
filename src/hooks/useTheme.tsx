import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Theme state shared via React Context. Mirrors the original Nuxt composable
 * (`composables/useTheme.ts`): `mode` is 'light' | 'dark' | 'auto'; `isDark`
 * is the resolved boolean (auto resolves via `prefers-color-scheme`).
 *
 * Persistence: `localStorage['theme-mode']`. Applied class on <html> is `.dark`.
 *
 * StrictMode-safe: the `matchMedia` listener uses `removeEventListener` cleanup,
 * and re-applying the theme on every mode change is idempotent.
 */

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "theme-mode";

export interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  return "auto";
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDarkClass(isDark: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isDark) root.classList.add("dark");
  else root.classList.remove("dark");
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(readStoredMode()));

  // Apply the `dark` class whenever the resolved boolean changes.
  useEffect(() => {
    applyDarkClass(isDark);
  }, [isDark]);

  // React to OS-level scheme changes when in `auto` mode.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (mode === "auto") setIsDark(mql.matches);
    };
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, [mode]);

  // Keep the resolved boolean in sync with the active mode.
  useEffect(() => {
    setIsDark(resolveIsDark(mode));
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}
