import { createFileRoute } from "@tanstack/react-router";

import { CalendarScreen, type CalendarView } from "@/components/calendar/CalendarScreen";

/**
 * "Kalendar" - the redesign merged the old "Uskoro" page into it as the Agenda
 * view, alongside Nedelja and the new Mesec.
 *
 * `view` is a search param so a specific view is linkable and survives a
 * reload; `day` is how the Danas week strip (and the month grid) hand a date
 * over to the agenda. Both are validated here so a hand-edited URL can only
 * ever land on a real view.
 */

export type KalendarView = CalendarView;

export const Route = createFileRoute("/_app/kalendar")({
  validateSearch: (search: Record<string, unknown>): { view?: CalendarView; day?: string } => {
    const result: { view?: CalendarView; day?: string } = {};
    const view = search.view;
    if (view === "agenda" || view === "nedelja" || view === "mesec") result.view = view;
    else if (view != null) result.view = "agenda";
    // `day` (YYYY-MM-DD) scrolls the agenda to a specific day.
    if (typeof search.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.day)) {
      result.day = search.day;
    }
    return result;
  },
  component: KalendarRoute,
});

function KalendarRoute() {
  const { view = "agenda", day } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <CalendarScreen
      view={view}
      day={day}
      onViewChange={(next) => {
        // Switching views drops `day`: it is a one-shot hand-off to the agenda,
        // and leaving it in the URL would re-scroll on every return.
        void navigate({ search: { view: next }, replace: true });
      }}
      onOpenDay={(next) => {
        // `resetScroll: false` is what makes the jump stick. With it on (the
        // default) the router writes the previous screen's scroll offset onto
        // the app scroll container in its `onRendered` pass - which lands AFTER
        // the agenda has started scrolling to `day` and cancels it mid-flight.
        // Nothing here wants the top of the list: the agenda scrolls itself.
        void navigate({ search: { view: "agenda", day: next }, resetScroll: false });
      }}
    />
  );
}
