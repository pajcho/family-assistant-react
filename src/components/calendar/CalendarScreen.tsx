import { Suspense, lazy, useEffect, useState } from "react";

import { AgendaFilters } from "@/components/dashboard/AgendaFilters";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { AgendaUpcomingList } from "@/components/dashboard/AgendaUpcomingList";
import { AgendaWeekCalendar } from "@/components/dashboard/AgendaWeekCalendar";
import { useAgendaEditForms } from "@/components/dashboard/useAgendaEditForms";
import { ProfileAvatarLink, SearchIconButton } from "@/components/common/ScreenActions";
import { Segmented, type SegmentedOption } from "@/components/common/Segmented";
import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { useAgendaFilters } from "@/hooks/useAgendaFilters";
import { useIsWide } from "@/hooks/useIsWide";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/cn";

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
 *
 * Chrome differs by width. Desktop (lg+) keeps everything - segments, filters,
 * week strip - in the screen's fixed header. On phones only the title stays
 * fixed: the segment control and the filters scroll away with the content to
 * give the list the screen back, and the week strip alone stays pinned - as a
 * `sticky` element INSIDE the scroll body (Agenda/Nedelja; the Mesec month row
 * scrolls away too, its sticky element is the selected-day line in the view).
 */

const MonthCalendar = lazy(() =>
  import("@/components/calendar/MonthCalendar").then((m) => ({ default: m.MonthCalendar })),
);

export type CalendarView = "agenda" | "week" | "month";

const VIEW_OPTIONS: ReadonlyArray<SegmentedOption<CalendarView>> = [
  { value: "agenda", label: "Agenda" },
  { value: "week", label: "Nedelja" },
  { value: "month", label: "Mesec" },
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
  const isWide = useIsWide();
  // Slot the views portal their week strip / month row into. The strip's
  // state - weeks, load dots, scroll-spy - lives with the view that owns the
  // data, but its PLACE belongs to the screen: the fixed header on desktop, a
  // sticky box in the scroll body on phones (the MoneyScreen add-button pattern).
  // `display: contents` so the portalled strip joins its container directly.
  const [stripSlot, setStripSlot] = useState<HTMLElement | null>(null);

  // The sticky strip box's height on phones - the offset the agenda's own
  // sticky day headers (and its scroll-to-day math) must clear so they park
  // under the strip instead of behind it.
  const [stickyBox, setStickyBox] = useState<HTMLElement | null>(null);
  const [stickyOffset, setStickyOffset] = useState(0);
  useEffect(() => {
    if (!stickyBox) {
      setStickyOffset(0);
      return;
    }
    // Measured fractionally and rounded DOWN. `offsetHeight` rounds to the
    // nearest integer, and a box that is really 94.5px tall reported 95 - so
    // every sticky header below parked half a pixel BELOW the strip's bottom
    // edge and the rows scrolling past showed through the seam (a full hairline
    // at 2x). Flooring parks them half a pixel high instead, under a strip that
    // outranks them (z-30 over z-10), where the overlap cannot be seen.
    const measure = () => setStickyOffset(Math.floor(stickyBox.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stickyBox);
    return () => observer.disconnect();
  }, [stickyBox]);

  const controls = (
    <>
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
    </>
  );

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
      {isWide ? (
        <>
          {controls}
          <div ref={setStripSlot} className="contents" />
        </>
      ) : null}
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
      // Nedelja on desktop is a two-axis timetable: it fills the body and
      // scrolls itself, so its day header and hour gutter have a scrollport to
      // pin against. On phones it renders at full height instead and the page
      // scrolls (see AgendaWeekCalendar's `pageScroll`).
      fillBody={view === "week" && isWide}
    >
      {!isWide ? (
        <>
          <div className="mb-2.5 flex flex-col gap-2.5">{controls}</div>
          {/* The one pinned piece of chrome on phones. Opaque background (no
              backdrop-filter - iOS fails to repaint it), small horizontal
              bleed so rows pass cleanly under. Mesec opts out: its month row
              scrolls away and the selected-day line takes the sticky slot. */}
          <div
            ref={setStickyBox}
            className={cn(
              "mb-2",
              view !== "month" && "sticky top-0 z-30 -mx-1.5 bg-background px-1.5 pb-1.5",
            )}
          >
            <div ref={setStripSlot} className="contents" />
          </div>
        </>
      ) : null}
      {!familyId ? (
        <AgendaListSkeleton rows={5} />
      ) : view === "week" ? (
        <AgendaWeekCalendar
          filter={filters.filter}
          stripSlot={stripSlot}
          pageScroll={!isWide}
          onEditEvent={forms.openEditEvent}
          onEditPayment={forms.openEditPayment}
          onEditBirthday={forms.openEditBirthday}
        />
      ) : view === "month" ? (
        <Suspense fallback={<AgendaListSkeleton rows={4} />}>
          <MonthCalendar
            filter={filters.filter}
            isFilterActive={filters.isActive}
            stripSlot={stripSlot}
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
          stripSlot={stripSlot}
          stickyOffset={stickyOffset}
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
