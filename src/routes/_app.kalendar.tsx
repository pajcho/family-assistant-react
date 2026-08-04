import { createFileRoute } from "@tanstack/react-router";

import { DashboardScope } from "@/components/dashboard/DashboardScope";
import { LegacyScreen } from "@/components/layout/AppScreen";

/**
 * "Kalendar" - the redesign merged the old "Uskoro" page into it as the Agenda
 * view, alongside Nedelja and the new Mesec.
 *
 * `view` is a search param so a specific view is linkable and survives a
 * reload (push notifications and the Danas week strip both deep-link here).
 *
 * NOTE (Lane A → Lane C): this currently renders the pre-redesign Uskoro
 * scope so navigation works end to end. Lane C replaces the body with the
 * segmented container (Agenda / Nedelja / Mesec) and the restyled views.
 */

export type KalendarView = "agenda" | "nedelja" | "mesec";

export const Route = createFileRoute("/_app/kalendar")({
  validateSearch: (search: Record<string, unknown>): { view?: KalendarView; day?: string } => {
    const result: { view?: KalendarView; day?: string } = {};
    const view = search.view;
    if (view === "agenda" || view === "nedelja" || view === "mesec") result.view = view;
    else if (view != null) result.view = "agenda";
    // `day` (YYYY-MM-DD) scrolls the agenda to a specific day - how the Danas
    // week strip hands off.
    if (typeof search.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.day)) {
      result.day = search.day;
    }
    return result;
  },
  component: () => (
    <LegacyScreen>
      <DashboardScope scope="uskoro" />
    </LegacyScreen>
  ),
});
