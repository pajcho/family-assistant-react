import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { endOfMonth, format } from "date-fns";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  SunIcon,
} from "@heroicons/react/24/outline";

import { Amount } from "@/components/common/Amount";
import { DayTimeline } from "@/components/dashboard/DayTimeline";
import { FirstStepsCard } from "@/components/dashboard/FirstStepsCard";
import { PersonFilterRow } from "@/components/dashboard/PersonFilterRow";
import { TodayRail } from "@/components/dashboard/TodayRail";
import { TodayWeekStrip } from "@/components/dashboard/TodayWeekStrip";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { AppScreen } from "@/components/layout/AppScreen";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { useAgenda } from "@/hooks/useAgenda";
import { useAgendaFilters } from "@/hooks/useAgendaFilters";
import { useAgendaSurface } from "@/hooks/useAgendaSurface";
import { useAuth } from "@/hooks/useAuth";
import { useFirstSteps } from "@/hooks/useFirstSteps";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import { useProfile } from "@/hooks/useProfile";
import { useSearchDialog } from "@/hooks/useSearchDialog";
import { useIsWide } from "@/hooks/useIsWide";
import { useToday } from "@/hooks/useToday";
import { getWeekStart } from "@/utils/activity";
import { addDays, srLocale } from "@/utils/date";
import { filterAgendaItems, isAgendaFilterActive } from "@/utils/agendaFilters";
import { greetingFor } from "@/utils/greeting";
import { placanjaLabel } from "@/utils/plural";

/**
 * "Danas" (redizajn 2.0).
 *
 * One screen, one timeline: the old list-vs-day-calendar toggle is gone - the
 * two views answered the same question and neither did it fully (the list lost
 * the sense of time, the calendar wasted a phone screen on empty hours).
 *
 * The header holds everything that frames the day and never scrolls away: the
 * greeting and date, the week strip (how loaded the rest of the week is), and
 * the person filter. The body is overdue first (money you already owe outranks
 * today's plans), then the timeline.
 *
 * One `useAgenda` covers both the timeline and the strip's load dots: it loads
 * today through the end of this week and the timeline takes today's slice.
 * Keeping it to a single agenda query per screen is deliberate - the hook fans
 * out to several tables.
 */
export function TodayScreen() {
  const { str: today, date: todayDate } = useToday();
  const { profile, familyId } = useProfile();
  const { user } = useAuth();
  const { openSearch } = useSearchDialog();
  const navigate = useNavigate();

  const filters = useAgendaFilters();
  const firstSteps = useFirstSteps();
  const surface = useAgendaSurface();

  // How far ahead to load. The phone only needs this week (the strip shows one
  // week and its past days are not selectable); the desktop rail also shows a
  // mini-month and "Sledeći dani", so it reaches the end of the month. Either
  // way it stays ONE useAgenda - the hook fans out to several tables per call.
  const isWide = useIsWide();
  const rangeEnd = useMemo(() => {
    const monday = getWeekStart(today);
    const weekEnd = format(addDays(new Date(`${monday}T12:00:00`), 6), "yyyy-MM-dd");
    if (!isWide) return weekEnd;
    const monthEnd = format(endOfMonth(new Date(`${today}T12:00:00`)), "yyyy-MM-dd");
    return monthEnd > weekEnd ? monthEnd : weekEnd;
  }, [today, isWide]);

  const { items: weekItems, isLoading } = useAgenda({ from: today, to: rangeEnd });
  const overdue = useOverduePayments();

  const todayItems = useMemo(
    () =>
      filterAgendaItems(
        weekItems.filter((item) => item.date === today),
        filters.filter,
      ),
    [weekItems, today, filters.filter],
  );

  const overdueItems = useMemo(
    () => filterAgendaItems(overdue.items, filters.filter),
    [overdue.items, filters.filter],
  );

  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of weekItems) map.set(item.date, (map.get(item.date) ?? 0) + 1);
    return map;
  }, [weekItems]);

  const overdueTotal = overdueItems.reduce(
    (sum, item) => (item.kind === "payment" ? sum + item.payment.amount : sum),
    0,
  );

  // Wave the 👋 only on the moment of dismissal (visible → dismissed in this
  // session), so returning to the screen while hidden waves nothing.
  const [waveHand, setWaveHand] = useState(false);
  const prevDismissedRef = useRef(firstSteps.dismissed);
  useEffect(() => {
    if (firstSteps.dismissed && !prevDismissedRef.current) setWaveHand(true);
    prevDismissedRef.current = firstSteps.dismissed;
  }, [firstSteps.dismissed]);

  const identity = {
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    email: user?.email ?? null,
  };

  const dateLabel = format(todayDate, "EEEE, d. MMMM", { locale: srLocale });
  const filterActive = isAgendaFilterActive(filters.filter);

  const header = (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[13.5px] italic text-muted-foreground">
            {greetingFor(todayDate)}
          </div>
          <h1 className="truncate text-[22px] leading-tight font-black tracking-tight">
            {dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
          </h1>
        </div>
        {firstSteps.dismissed ? (
          <button
            type="button"
            onClick={firstSteps.unhide}
            disabled={firstSteps.hiding}
            aria-label="Prikaži Prve korake"
            title="Prikaži Prve korake"
            className="grid size-[34px] flex-none place-items-center rounded-md text-base transition-colors hover:bg-muted"
          >
            <span
              className={waveHand ? "animate-wave inline-block" : "inline-block"}
              onAnimationEnd={() => setWaveHand(false)}
            >
              👋
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={openSearch}
          aria-label="Pretraga"
          className="grid size-[34px] flex-none place-items-center rounded-md border border-border bg-card text-foreground shadow-card transition-transform active:scale-90"
        >
          <MagnifyingGlassIcon className="size-[17px]" />
        </button>
        <Link
          to="/settings"
          aria-label="Profil i podešavanja"
          className="flex-none rounded-md transition-transform active:scale-90"
        >
          <UserAvatar {...identity} className="size-[34px] rounded-md" />
        </Link>
      </div>

      {/* On desktop the strip and the filters belong to the timeline column,
          not to the full width - a seven-day strip stretched over 1000px reads
          as a calendar of its own. */}
      <div className="flex flex-col gap-2.5 lg:max-w-[640px]">
        <TodayWeekStrip today={today} countByDay={countByDay} />

        <PersonFilterRow
          selected={filters.filter.personIds}
          onToggle={filters.togglePerson}
          onClear={filters.reset}
        />
      </div>
    </div>
  );

  return (
    <AppScreen
      header={header}
      contentClassName="mx-auto w-full max-w-3xl lg:max-w-[1010px]"
      bodyClassName="lg:px-8"
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,640px)_320px] lg:items-start lg:gap-6">
        <div className="min-w-0">
          {!familyId ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Učitavanje…</p>
          ) : (
            <>
              {overdueItems.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    void navigate({ to: "/novac", search: { tab: "placanja" } });
                  }}
                  className="mb-2.5 flex w-full items-center gap-2.5 rounded-lg bg-neg-soft px-3.5 py-3 text-left text-[13.5px] font-bold text-neg transition-transform active:scale-[0.98] lg:hidden"
                >
                  <ExclamationTriangleIcon className="size-[17px] flex-none" />
                  <span>
                    Prekoračeno · {overdueItems.length} {placanjaLabel(overdueItems.length)}
                  </span>
                  <span className="ml-auto font-extrabold tabular-nums">
                    <Amount value={overdueTotal} round />
                  </span>
                  <ChevronRightIcon className="size-[15px] flex-none" />
                </button>
              ) : null}

              {firstSteps.visible ? (
                <div className="mb-3">
                  <FirstStepsCard
                    firstSteps={firstSteps}
                    onAddEvent={surface.openAddEvent}
                    onAddPayment={surface.openAddPayment}
                  />
                </div>
              ) : null}

              {isLoading ? (
                <AgendaListSkeleton rows={4} />
              ) : (
                <DayTimeline
                  items={todayItems}
                  onSelect={surface.onSelect}
                  emptyState={
                    <TodayEmpty
                      filterActive={filterActive}
                      hasOverdue={overdueItems.length > 0}
                      onboardingActive={firstSteps.visible}
                    />
                  }
                />
              )}
            </>
          )}
        </div>
        <TodayRail
          today={today}
          overdueItems={overdueItems}
          upcoming={weekItems}
          countByDay={countByDay}
        />
      </div>
      {surface.dialogs}
    </AppScreen>
  );
}

/**
 * Nothing scheduled today. Copy is unchanged from the pre-redesign screen,
 * including the deliberate absence of the user's first name (Serbian vocative)
 * and the matter-of-fact tone while "Prvi koraci" is still up or something is
 * overdue - celebrating an empty day above an unpaid bill reads badly.
 */
function TodayEmpty({
  filterActive,
  hasOverdue,
  onboardingActive,
}: {
  filterActive: boolean;
  hasOverdue: boolean;
  onboardingActive: boolean;
}) {
  if (filterActive) {
    return (
      <p className="py-10 text-center text-sm font-semibold text-muted-foreground">
        Nema stavki za izabrane filtere.
      </p>
    );
  }

  const title = hasOverdue
    ? "Za danas nemaš zakazanih obaveza."
    : onboardingActive
      ? "Za danas nema ničega."
      : "Uživaj u danu.";
  const description = hasOverdue
    ? "Iznad je samo ono što je prekoračeno."
    : onboardingActive
      ? 'Dodaj nešto preko „Prvih koraka" iznad - ili predahni.'
      : "Nemaš ništa zakazano za danas, slobodno predahni.";

  return (
    <div className="px-5 py-10 text-center">
      <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-warn-soft">
        <SunIcon className="size-7 text-warn" />
      </div>
      <p className="font-serif text-base text-foreground italic">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed font-semibold text-muted-foreground">
        {description}
      </p>
      <Link
        to="/kalendar"
        search={{ view: "agenda" }}
        className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-accent-deep hover:underline"
      >
        Pogledaj kalendar →
      </Link>
    </div>
  );
}
