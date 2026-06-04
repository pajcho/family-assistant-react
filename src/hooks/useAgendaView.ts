import { useCallback, useState } from "react";

/**
 * The list↔calendar view preference for one dashboard page (Danas or Uskoro),
 * persisted per page in localStorage (NOT the URL) — it sticks until changed.
 *
 * Per-device, best-effort: storage being unavailable (private mode / quota) just
 * means the choice doesn't persist, the UI still works. The Phase 4 calendar
 * views read this to decide list vs calendar; for now calendar is a placeholder.
 */
export type AgendaView = "list" | "calendar";

export type AgendaPage = "danas" | "uskoro";

function storageKey(page: AgendaPage): string {
  return `fa:agenda-view:${page}`;
}

function readStored(page: AgendaPage): AgendaView {
  if (typeof window === "undefined") return "list";
  try {
    return window.localStorage.getItem(storageKey(page)) === "calendar" ? "calendar" : "list";
  } catch {
    return "list";
  }
}

export interface UseAgendaViewResult {
  view: AgendaView;
  setView: (view: AgendaView) => void;
}

export function useAgendaView(page: AgendaPage): UseAgendaViewResult {
  // Read synchronously on mount — the app is a client-only SPA, so there's no
  // SSR flash to guard against and an honest first value avoids a list→calendar
  // flicker on load.
  const [view, setViewState] = useState<AgendaView>(() => readStored(page));

  const setView = useCallback(
    (next: AgendaView) => {
      setViewState(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey(page), next);
      } catch {
        // Best-effort — persistence is optional, the toggle still works in-session.
      }
    },
    [page],
  );

  return { view, setView };
}
