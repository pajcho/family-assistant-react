import { createContext, useCallback, useContext } from "react";
import type { ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

/**
 * Pregled dečije aplikacije - a grown-up looking at the kid shell as one of
 * their children, from their own session.
 *
 * It exists for the decision a parent cannot otherwise make: whether to turn
 * kid access ON. Before it is on there is no kid account, no PIN and no linked
 * device, so the only way to see the child's app is to BE the parent while the
 * shell pretends to be the child.
 *
 * That pretence is deliberately shallow, and stops at the identity:
 *
 *   - It swaps `kidProfileId` and nothing else. `useKidSession().isKid` stays
 *     FALSE - the session really is a grown-up's, and anything keyed on `isKid`
 *     (the stored-theme query, the kid layout's redirects) must keep seeing the
 *     truth. `isPreview` is the separate flag for "render as a child".
 *   - It performs no writes at all. The kid shell's single mutation is the
 *     theme (`kid_set_theme`), which a parent may not call and which has no row
 *     to write to before access exists, so in preview the theme is local state.
 *   - It does NOT widen what is read. A parent's session can see the whole
 *     family, so every kid screen filters to the child in code (see
 *     `filterKidAgendaItems` and `useKidBirthdayVisibility`) - which is what
 *     makes the preview honest rather than flattering.
 *
 * The preview has no routes of its own beyond `/kid/pregled`: it hosts the four
 * kid tabs as local state so it can reuse the very same screen components a
 * child gets, instead of a parallel copy that would drift.
 */

/** The four kid tabs, as the real route paths they are outside the preview. */
export const KID_TAB_PATHS = ["/kid", "/kid/uskoro", "/kid/raspored", "/kid/porodica"] as const;
export type KidTabPath = (typeof KID_TAB_PATHS)[number];

/**
 * Where "Izađi iz pregleda" goes: the family screen the preview was launched
 * from, with the same child still open.
 *
 * Typed navigate options rather than an href, because the app is served under a
 * `basepath` on Pages and only `navigate` knows about it - and passed to
 * `navigate` whole, never destructured down to `to`, or the `search` half goes
 * missing and the parent lands on the settings hub instead of Porodica.
 *
 * `clan` is what turns this from "go to the family screen" into a real back:
 * the member master-detail keeps its selection in local state, so without a
 * param to seed it the parent returns to the roster rather than to the child
 * they were just previewing.
 */
export interface KidPreviewExit {
  to: "/settings";
  search: { tab: "family"; clan?: string };
}

export function kidPreviewExit(profileId?: string | null): KidPreviewExit {
  return {
    to: "/settings",
    search: { tab: "family", ...(profileId ? { clan: profileId } : {}) },
  };
}

export interface KidPreviewValue {
  /** The child being previewed - stands in for the kid session's profile id. */
  previewProfileId: string;
  /** Their first name, for the banner ("Ovako aplikaciju vidi Vuk"). */
  previewName: string;
  /** The parent's family, so `useKidSession` can answer honestly. */
  familyId: string | null;
  exitTo: KidPreviewExit;
  /** Leaves the preview, back to `exitTo`. */
  exit: () => void;
  tab: KidTabPath;
  setTab: (tab: KidTabPath) => void;
}

const KidPreviewContext = createContext<KidPreviewValue | null>(null);

export function KidPreviewProvider({
  value,
  children,
}: {
  value: KidPreviewValue;
  children: ReactNode;
}) {
  return <KidPreviewContext.Provider value={value}>{children}</KidPreviewContext.Provider>;
}

/** The preview being rendered, or `null` in the real kid shell. */
export function useKidPreview(): KidPreviewValue | null {
  return useContext(KidPreviewContext);
}

/**
 * Switch kid tabs, whichever shell we are in: a route change for a child, a
 * state change inside the preview (whose four tabs share one route).
 */
export function useKidTabNavigate(): (to: KidTabPath) => void {
  const preview = useKidPreview();
  const navigate = useNavigate();

  return useCallback(
    (to: KidTabPath) => {
      if (preview) {
        preview.setTab(to);
        return;
      }
      void navigate({ to });
    },
    [preview, navigate],
  );
}

/** Which tab is showing - for the bottom bar's `aria-current` and highlight. */
export function useKidActiveTab(): KidTabPath {
  const preview = useKidPreview();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (preview) return preview.tab;
  // Longest match first, so `/kid/uskoro` never resolves to `/kid`.
  return (
    [...KID_TAB_PATHS]
      .sort((a, b) => b.length - a.length)
      .find((path) => pathname === path || pathname.startsWith(`${path}/`)) ?? "/kid"
  );
}
