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
  // Keep the iOS PWA status-bar tint in sync. The single unconditional
  // <meta name="theme-color"> is set by the bootstrap script in index.html;
  // we just patch its `content` on every theme flip.
  const meta = document.head.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "#111827" : "#2563eb");
}

/**
 * Toggle the `.dark` class on <html> while suppressing transitions, so the
 * 200ms transition-colors rule on `*` doesn't fire a cascading flicker on
 * every theme switch. The `.theme-switching` class kills transitions; we
 * remove it on the next animation frame after the browser has painted the
 * new theme.
 */
function applyDarkClassNoTransition(isDark: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyDarkClass(isDark);
  // Force a reflow so the class is applied before transitions resume.
  // `void` discards the value the linter would otherwise flag.
  void root.offsetHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(readStoredMode()));

  // React to OS-level scheme changes when in `auto` mode.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (mode === "auto") {
        const nextIsDark = mql.matches;
        applyDarkClassNoTransition(nextIsDark);
        setIsDark(nextIsDark);
      }
    };
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    const nextIsDark = resolveIsDark(next);
    // Flip the DOM class synchronously so the browser sees the new theme
    // on the very next paint - no waiting for React's render cycle to
    // propagate state through useEffect.
    applyDarkClassNoTransition(nextIsDark);
    setIsDark(nextIsDark);
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
