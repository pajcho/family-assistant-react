import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useKidSession } from "@/hooks/useKidSession";
import type { KidAccess } from "@/types/database";
import { DEFAULT_KID_THEME, normalizeKidTheme, type KidTheme } from "@/types/kid";

/**
 * The theme is the ONLY thing a child can change in the entire kid shell, and
 * the only write the shell performs.
 *
 * It is stored on `kid_access.theme` (English keys) and written through the
 * `kid_set_theme` RPC rather than an UPDATE policy: an UPDATE policy on
 * `kid_access` would have to be scoped by column to stop a child flipping
 * `is_enabled` or `pin_hash`, and Postgres row policies do not do that. The RPC
 * validates the key and touches exactly one column of exactly one row.
 */

// ---------------------------------------------------------------------------
// Painting a theme onto the document
// ---------------------------------------------------------------------------

/**
 * Status-bar tint per theme - the FIRST stop of each gradient, because the
 * gradient header (and, on the login screens, the whole page) is what sits
 * under the iOS status bar. Keep in sync with `--k-grad` in `styles/kid.css`.
 */
const KID_THEME_COLORS: Record<KidTheme, string> = {
  ocean: "#41b7f0",
  jungle: "#43c06e",
  sun: "#ffc53d",
  candy: "#f675b4",
  watermelon: "#ff6b7a",
  lavender: "#b096e6",
  pearl: "#c98ba3",
  space: "#5b5be0",
};

/** The main app's own status-bar tints - restored when the kid shell unmounts. */
const APP_THEME_COLOR_LIGHT = "#f4f1f6";
const APP_THEME_COLOR_DARK = "#151019";

function setThemeColorMeta(color: string): void {
  const meta = document.head.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
}

/**
 * Put the kid theme on `<html>`, or take it off again (`null`). Exported so a
 * screen that renders before the session exists (login / device link) can paint the
 * remembered theme immediately, without waiting for a query.
 */
export function applyKidThemeToDom(theme: KidTheme | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme) {
    root.setAttribute("data-kid-theme", theme);
    setThemeColorMeta(KID_THEME_COLORS[theme]);
    return;
  }
  root.removeAttribute("data-kid-theme");
  setThemeColorMeta(root.classList.contains("dark") ? APP_THEME_COLOR_DARK : APP_THEME_COLOR_LIGHT);
}

/**
 * Paint `theme` for as long as the calling component is mounted, and hand the
 * document back to the main app on unmount. Mounted once, by the `kid` layout.
 */
export function useApplyKidTheme(theme: KidTheme): void {
  useEffect(() => {
    applyKidThemeToDom(theme);
    return () => applyKidThemeToDom(null);
  }, [theme]);
}

// ---------------------------------------------------------------------------
// Reading + writing the stored theme
// ---------------------------------------------------------------------------

export interface UseKidThemeResult {
  theme: KidTheme;
  isLoading: boolean;
  setTheme: (theme: KidTheme) => void;
  isSaving: boolean;
}

/**
 * The signed-in child's stored theme, plus the setter.
 *
 * `fallback` is what to show before the row arrives - the login screen caches
 * the theme in `KID_DEVICES_STORAGE_KEY` precisely so the first painted frame
 * after sign-in is already the right colour instead of flashing Okean.
 */
export function useKidTheme(fallback: KidTheme = DEFAULT_KID_THEME): UseKidThemeResult {
  const { isKid, authUserId } = useKidSession();
  const queryClient = useQueryClient();
  const queryKey = ["kid-access", authUserId] as const;

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<KidAccess | null> => {
      const { data, error } = await supabase
        .from("kid_access")
        .select("*")
        .eq("auth_user_id", authUserId as string)
        .maybeSingle();
      if (error) return null;
      return (data as KidAccess) ?? null;
    },
    enabled: isKid && !!authUserId,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (theme: KidTheme): Promise<void> => {
      const { error } = await supabase.rpc("kid_set_theme", { p_theme: theme });
      if (error) throw new Error(error.message);
    },
    // Optimistic: a theme switch has to feel instant, and the whole screen
    // repaints from it. Roll back on failure and say so in the child's words.
    onMutate: async (theme) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<KidAccess | null>(queryKey);
      queryClient.setQueryData<KidAccess | null>(queryKey, (old) =>
        old ? { ...old, theme } : old,
      );
      return { previous };
    },
    onError: (_error, _theme, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(queryKey, context.previous);
      toast.error("Nije uspelo. Probaj još jednom.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const stored = query.data?.theme;
  return {
    theme: stored ? normalizeKidTheme(stored) : fallback,
    isLoading: query.isLoading,
    setTheme: mutation.mutate,
    isSaving: mutation.isPending,
  };
}
