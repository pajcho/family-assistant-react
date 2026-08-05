import { Suspense, lazy } from "react";

import { AgendaFilters } from "@/components/dashboard/AgendaFilters";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { AgendaUpcomingList } from "@/components/dashboard/AgendaUpcomingList";
import { AgendaWeekCalendar } from "@/components/dashboard/AgendaWeekCalendar";
import { useAgendaEditForms } from "@/components/dashboard/useAgendaEditForms";
import { ProfileAvatarLink, SearchIconButton } from "@/components/common/ScreenActions";
import { Segmented, type SegmentedOption } from "@/components/common/Segmented";
import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { useAgendaFilters } from "@/hooks/useAgendaFilters";
import { useProfile } from "@/hooks/useProfile";

/**
 * "Kalendar" - one screen, three ways to read the same agenda.
 *
 * Redizajn 2.0 folded the old "Uskoro" page in here as the Agenda segment and
 * added Mesec next to the weekly grid. The container owns everything the three
 * views share: the header, the segment control and the type/member filter
 * chips, plus the add/edit form dialogs their detail sheets route "Izmeni"
 * into. Each view then owns its own window and its own `useAgenda` fetch.
 *
 * Exactly one view is mounted at a time. That is load-bearing: two `useAgenda`
 * instances would duplicate the whole fan-out of queries behind the agenda.
 *
 * `view` lives in the URL (not in state) so a segment is linkable and survives
 * a reload; `day` is the hand-off from the Danas week strip and scrolls the
 * agenda to that date. Mesec is a lazy chunk - it is the one view that is not
 * on the default path.
 */

const MonthCalendar = lazy(() =>
  import("@/components/calendar/MonthCalendar").then((m) => ({ default: m.MonthCalendar })),
);

export type CalendarView = "agenda" | "nedelja" | "mesec";

const VIEW_OPTIONS: ReadonlyArray<SegmentedOption<CalendarView>> = [
  { value: "agenda", label: "Agenda" },
  { value: "nedelja", label: "Nedelja" },
  { value: "mesec", label: "Mesec" },
];

export type CalendarScreenProps = {
  view: CalendarView;
  /** yyyy-MM-dd the agenda should scroll to, if any. */
  day?: string;
  onViewChange: (view: CalendarView) => void;
  /** Jump to a specific day in the agenda view (from the month grid). */
  onOpenDay: (day: string) => void;
};

export function CalendarScreen({ view, day, onViewChange, onOpenDay }: CalendarScreenProps) {
  const { familyId } = useProfile();
  const filters = useAgendaFilters();
  const forms = useAgendaEditForms();

  const header = (
    <div className="flex flex-col gap-2.5">
      <ScreenHeaderRow
        title="Kalendar"
        actions={
          <>
            <SearchIconButton />
            <ProfileAvatarLink />
          </>
        }
      />
      <Segmented
        options={VIEW_OPTIONS}
        value={view}
        onChange={onViewChange}
        ariaLabel="Prikaz kalendara"
      />
      <AgendaFilters
        filter={filters.filter}
        toggleKind={filters.toggleKind}
        togglePerson={filters.togglePerson}
        reset={filters.reset}
        isActive={filters.isActive}
      />
    </div>
  );

  return (
    // ONE column width for all three views: it used to be full-width for
    // Nedelja/Mesec and narrow for Agenda, so switching views slid the segment
    // control and the filter chips sideways. The grids need the room (a month
    // squeezed into 768px wastes the format), but unbounded width turns the
    // agenda into a stretched row of name-on-the-left, time-on-the-right - so
    // the column stops at Danas' width, the app's wide-screen ceiling.
    <AppScreen
      header={header}
      contentClassName="mx-auto w-full max-w-3xl lg:max-w-[1010px]"
      headerClassName="lg:px-8"
      bodyClassName="lg:px-8"
      // Nedelja is a two-axis timetable: it fills the body and scrolls itself,
      // so its day header and hour gutter have a scrollport to pin against.
      fillBody={view === "nedelja"}
    >
      {!familyId ? (
        <AgendaListSkeleton rows={5} />
      ) : view === "nedelja" ? (
        <AgendaWeekCalendar
          filter={filters.filter}
          onEditEvent={forms.openEditEvent}
          onEditPayment={forms.openEditPayment}
          onEditBirthday={forms.openEditBirthday}
        />
      ) : view === "mesec" ? (
        <Suspense fallback={<AgendaListSkeleton rows={4} />}>
          <MonthCalendar
            filter={filters.filter}
            isFilterActive={filters.isActive}
            onOpenDay={onOpenDay}
            onEditEvent={forms.openEditEvent}
            onEditPayment={forms.openEditPayment}
            onEditBirthday={forms.openEditBirthday}
          />
        </Suspense>
      ) : (
        <AgendaUpcomingList
          filter={filters.filter}
          scrollToDay={day}
          onAddEvent={forms.openAddEvent}
          onEditEvent={forms.openEditEvent}
          onEditPayment={forms.openEditPayment}
          onEditBirthday={forms.openEditBirthday}
        />
      )}
      {forms.dialogs}
    </AppScreen>
  );
}
