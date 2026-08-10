import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, type ProfileWithFamily } from "@/hooks/useProfile";

/**
 * App colour - the in-app accent, one token per user.
 *
 * Keys are English color names ("blue" | "purple" | "green" | "brown") because
 * they are persisted in the database; only the labels are Serbian, so a future
 * localization pass never has to touch stored values.
 *
 * The design language (the "plum" palette) is the neutral layer and never changes; the
 * accent is a separate CSS variable trio (--accent / --accent-soft /
 * --accent-deep, see styles/index.css) swapped by a `data-accent` attribute on
 * <html>. The brand OUTSIDE the app - PWA icon, login mark, splash - stays
 * blue no matter what is picked here.
 *
 * Storage is two-tier on purpose:
 *   - `profiles.accent` is the source of truth, so the choice follows the user
 *     across devices;
 *   - `localStorage` mirrors it so the very first paint (before the profile
 *     query resolves, and before React even mounts - see the bootstrap script
 *     in index.html) already has the right accent instead of flashing blue.
 */

export const ACCENT_KEYS = ["blue", "purple", "green", "brown"] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];

export const DEFAULT_ACCENT: AccentKey = "blue";

/** localStorage key - kept in sync with the bootstrap script in index.html. */
const STORAGE_KEY = "app-accent";

export interface AccentOption {
  key: AccentKey;
  label: string;
  /** Swatch shown in the picker: the light-theme accent value. */
  swatch: string;
  hint: string;
}

export const ACCENT_OPTIONS: readonly AccentOption[] = [
  { key: "blue", label: "Plava", swatch: "#2563eb", hint: "Podrazumevana" },
  { key: "purple", label: "Ljubičasta", swatch: "#7c3f87", hint: "Topla, šljivina" },
  { key: "green", label: "Zelena", swatch: "#2f6b4f", hint: "Prigušena" },
  { key: "brown", label: "Braon", swatch: "#9a4a2f", hint: "Topla, ciglasta" },
];

export function normalizeAccent(raw: string | null | undefined): AccentKey {
  if (!raw) return DEFAULT_ACCENT;
  return (ACCENT_KEYS as readonly string[]).includes(raw) ? (raw as AccentKey) : DEFAULT_ACCENT;
}

function readStoredAccent(): AccentKey {
  if (typeof window === "undefined") return DEFAULT_ACCENT;
  return normalizeAccent(window.localStorage.getItem(STORAGE_KEY));
}

/**
 * Stamp the accent on <html>. "blue" is the CSS default, so it clears the
 * attribute instead of writing it - one less selector to match at runtime.
 */
function applyAccent(accent: AccentKey): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (accent === DEFAULT_ACCENT) root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", accent);
}

/**
 * Read the accent for rendering + a setter that persists it. The setter
 * applies to the DOM synchronously (no waiting for the round trip) and the
 * profile update is optimistic, so the whole app recolors on tap.
 */
export function useAccent(): {
  accent: AccentKey;
  setAccent: (next: AccentKey) => void;
  isSaving: boolean;
} {
  const { profile } = useProfile();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  // Until the profile query resolves, the locally mirrored value is the best
  // guess - and for a returning user it is always the right one.
  const accent = profile ? normalizeAccent(profile.accent) : readStoredAccent();

  const mutation = useMutation({
    mutationFn: async (next: AccentKey): Promise<void> => {
      if (!userId) throw new Error("Niste prijavljeni");
      const { error } = await supabase.from("profiles").update({ accent: next }).eq("id", userId);
      if (error) throw new Error(error.message);
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["profile", userId] });
      const previous = queryClient.getQueryData<ProfileWithFamily | null>(["profile", userId]);
      queryClient.setQueryData<ProfileWithFamily | null>(["profile", userId], (old) =>
        old ? { ...old, profile: { ...old.profile, accent: next } } : old,
      );
      return { previous };
    },
    onError: (e, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["profile", userId], context.previous);
        applyAccent(normalizeAccent(context.previous?.profile.accent));
      }
      toast.error(e instanceof Error ? e.message : "Greška pri čuvanju boje");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    },
  });

  const setAccent = (next: AccentKey) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    applyAccent(next);
    mutation.mutate(next);
  };

  return { accent, setAccent, isSaving: mutation.isPending };
}

/**
 * Keep <html data-accent> and the localStorage mirror in step with the
 * profile. Mounted once in the authenticated layout; the login screen keeps
 * whatever the bootstrap script applied (or the default blue).
 */
export function useAccentSync(): void {
  const { profile } = useProfile();
  const accent = profile ? normalizeAccent(profile.accent) : null;

  useEffect(() => {
    if (!accent) return;
    window.localStorage.setItem(STORAGE_KEY, accent);
    applyAccent(accent);
  }, [accent]);
}
