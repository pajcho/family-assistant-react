import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { addDays, addWeeks, format, getDay, parseISO } from "date-fns";
import {
  AcademicCapIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";

import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { IconButton } from "@/components/common/IconButton";
import { PersonChip } from "@/components/activities/PersonChip";
import { useMinuteTick } from "@/components/dashboard/agendaCalendarShared";
import {
  BellScheduleCard,
  SchoolBreaksCard,
  SchoolShiftCard,
} from "@/components/school/SchoolCards";
import { SchoolDayCard } from "@/components/school/SchoolDayCard";
import { SchoolOptionsSheet, type SchoolOptionsView } from "@/components/school/SchoolOptionsSheet";
import { SchoolWeekTable } from "@/components/school/SchoolWeekTable";
import { useBellSchedule } from "@/hooks/useBellSchedule";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useSchoolBreaks } from "@/hooks/useSchoolBreaks";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useSchoolTimetable } from "@/hooks/useSchoolTimetable";
import { useToday } from "@/hooks/useToday";
import { useWeekSchool } from "@/hooks/useWeekSchool";
import type { SchoolShift } from "@/types/database";
import { getWeekStart } from "@/utils/activity";
import { srLocale } from "@/utils/date";
import { nextBreak, nextWeekStart, weekOutlook } from "@/utils/schoolOverview";
import { computeBellGrid, timeBandForWeek } from "@/utils/schoolTimetable";

/**
 * School - the timetable, the A/B shifts, the bell schedule and the breaks,
 * on a screen of their own.
 *
 * All of this used to hide behind a gear button in the Aktivnosti header, which
 * made a whole feature findable only by accident. The split follows what the
 * two pages are for: Aktivnosti is what the family SIGNED UP for (training,
 * music school) and still draws the classes as faint background; this page is
 * what school itself dictates, and it is the only place that configures it.
 *
 * One child at a time, deliberately. A per-child bell grid means two children
 * in different smene have different rows at different times, and stacking those
 * into one table produces a grid that is true for nobody.
 */

/** Mon-first index (0 = Monday) for a Date. */
function mondayFirstIndex(date: Date): number {
  return (getDay(date) + 6) % 7;
}

/** "21 - 25. septembar", collapsing the month when the week does not span two. */
function formatSchoolWeekRange(weekStart: string): string {
  const start = parseISO(weekStart + "T12:00:00");
  const end = addDays(start, 4);
  if (start.getMonth() === end.getMonth()) {
    return `${format(start, "d", { locale: srLocale })} - ${format(end, "d. MMMM", {
      locale: srLocale,
    })}`;
  }
  return `${format(start, "d. MMM", { locale: srLocale })} - ${format(end, "d. MMM", {
    locale: srLocale,
  })}`;
}

export function SchoolScreen() {
  const navigate = useNavigate();
  const today = useToday();
  const now = useMinuteTick();

  const { members } = useFamilyMembers();
  const { byPersonId: anchorsByPersonId, isLoading: anchorsLoading } = useSchoolShiftAnchors();
  const { bell, isLoading: bellLoading } = useBellSchedule();
  const timetableQuery = useSchoolTimetable();
  const { breaks, memberIdsByBreak } = useSchoolBreaks();

  // Weeks are held as an OFFSET, never as a frozen date: an installed PWA can
  // sit open across midnight, and an absolute weekStart captured at mount would
  // quietly keep showing last week after the rollover (see useToday).
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  // `null` view = closed. The nonce remounts the sheet so an entry point deeper
  // than the hub is in place on the very first frame, with no hub flashing
  // underneath it.
  const [options, setOptions] = useState<{ view: SchoolOptionsView | null; nonce: number }>({
    view: null,
    nonce: 0,
  });

  const openOptions = (view: SchoolOptionsView) =>
    setOptions((prev) => ({ view, nonce: prev.nonce + 1 }));

  const thisWeekStart = getWeekStart(today.str);
  const weekStart = useMemo(
    () => format(addWeeks(parseISO(thisWeekStart + "T12:00:00"), weekOffset), "yyyy-MM-dd"),
    [thisWeekStart, weekOffset],
  );

  const students = useMemo(
    () => members.filter((member) => anchorsByPersonId.has(member.id)),
    [members, anchorsByPersonId],
  );
  // Falling back to the first student keeps the page working when the selected
  // child stops being one (the student toggle flipped in another session).
  const selected = students.find((s) => s.id === selectedPersonId) ?? students[0] ?? null;
  const anchor = selected ? anchorsByPersonId.get(selected.id) : undefined;

  const personFilter = useMemo(
    () => (selected ? new Set([selected.id]) : new Set<string>()),
    [selected],
  );
  const school = useWeekSchool(weekStart, personFilter);

  const entries = useMemo(() => timetableQuery.data ?? [], [timetableQuery.data]);
  const hasTimetable = useMemo(
    () => (selected ? entries.some((entry) => entry.person_id === selected.id) : false),
    [entries, selected],
  );

  // Weekend days only appear if a class actually lands there - the editor only
  // offers Mon-Fri, so this is pure defensiveness against hand-written rows.
  const dayCount = useMemo(
    () => school.blocks.reduce((max, block) => Math.max(max, block.dayOfWeek + 1), 5),
    [school.blocks],
  );

  const todayIndex = useMemo(() => {
    if (weekOffset !== 0) return null;
    const index = mondayFirstIndex(today.date);
    return index < dayCount ? index : null;
  }, [weekOffset, today.date, dayCount]);
  const nowMinutes = todayIndex == null ? null : now.getHours() * 60 + now.getMinutes();

  // Land on today when the week (or the calendar day) changes; the user's own
  // chip taps live until then.
  useEffect(() => {
    setSelectedDay(todayIndex ?? 0);
  }, [weekStart, todayIndex]);

  const outlook = useMemo(
    () => (anchor ? weekOutlook(anchor, bell, weekStart) : null),
    [anchor, bell, weekStart],
  );
  const nextOutlook = useMemo(
    () => (anchor ? weekOutlook(anchor, bell, nextWeekStart(weekStart)) : null),
    [anchor, bell, weekStart],
  );

  const slots = useMemo(
    () => (outlook ? computeBellGrid(bell, outlook.band, outlook.usesPredcas) : []),
    [bell, outlook],
  );
  const maxPeriod = useMemo(
    () => school.blocks.reduce((max, block) => Math.max(max, block.periodIndex), 0),
    [school.blocks],
  );
  const visibleSlots = useMemo(() => slots.slice(0, Math.max(maxPeriod, 1)), [slots, maxPeriod]);
  const bigBreakAfter = slots.find((slot) => slot.bigBreakAfter)?.periodIndex ?? 0;

  const todaySpan = useMemo(() => {
    if (todayIndex == null) return null;
    const dayBlocks = school.blocks.filter((block) => block.dayOfWeek === todayIndex);
    if (dayBlocks.length === 0) return null;
    return `${dayBlocks[0].startTime} - ${dayBlocks[dayBlocks.length - 1].endTime}`;
  }, [school.blocks, todayIndex]);

  // Counted from TODAY, so it only belongs on the card while the card is about
  // now. Browsing back to May and being told the summer break "traje" is a
  // true sentence in the wrong place.
  const nextBreakHit = useMemo(
    () =>
      weekOffset !== 0
        ? null
        : nextBreak({
            today: today.str,
            breaks,
            memberIdsByBreak,
            personIds: selected ? [selected.id] : [],
          }),
    [weekOffset, today.str, breaks, memberIdsByBreak, selected],
  );

  // Distinct raspust labels touching the shown week - the explanation for a
  // week that has a timetable but produced no classes at all.
  const weekBreakNote = useMemo(
    () => [...new Set(school.breakDays.values())].join(" · "),
    [school.breakDays],
  );

  // Sun/moon badge per chip - each child's own band for the shown week.
  const timeBandByPerson = useMemo(() => {
    const map = new Map<string, SchoolShift>();
    for (const [personId, personAnchor] of anchorsByPersonId) {
      map.set(personId, timeBandForWeek(personAnchor, weekStart));
    }
    return map;
  }, [anchorsByPersonId, weekStart]);

  const selectedDate = format(
    addDays(parseISO(weekStart + "T12:00:00"), selectedDay),
    "yyyy-MM-dd",
  );
  const isLoading = anchorsLoading || bellLoading || timetableQuery.isLoading;

  const header = (
    <div className="flex flex-col gap-2.5">
      <ScreenHeaderRow
        title="Škola"
        actions={
          <IconButton
            icon={Cog6ToothIcon}
            aria-label="Opcije"
            onClick={() => openOptions({ kind: "hub" })}
          />
        }
      />
      {students.length > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <IconButton
              icon={ChevronLeftIcon}
              aria-label="Prethodna nedelja"
              onClick={() => setWeekOffset((v) => v - 1)}
            />
            <div className="flex-1 text-center text-sm font-bold">
              {formatSchoolWeekRange(weekStart)}
            </div>
            <IconButton
              icon={ChevronRightIcon}
              aria-label="Sledeća nedelja"
              onClick={() => setWeekOffset((v) => v + 1)}
            />
          </div>
          {weekOffset !== 0 || students.length > 1 ? (
            <FilterChipRow ariaLabel="Izbor deteta i nedelje">
              {weekOffset !== 0 ? (
                <FilterChip active={false} onToggle={() => setWeekOffset(0)} icon={ClockIcon}>
                  Ova sedmica
                </FilterChip>
              ) : null}
              {weekOffset !== 0 && students.length > 1 ? (
                <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
              ) : null}
              {students.length > 1
                ? students.map((student) => (
                    <PersonChip
                      key={student.id}
                      person={student}
                      // Exclusive, not additive: the table is one child's.
                      active={student.id === selected?.id}
                      onToggle={() => setSelectedPersonId(student.id)}
                      shift={timeBandByPerson.get(student.id) ?? null}
                    />
                  ))
                : null}
            </FilterChipRow>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return (
    <AppScreen header={header} contentClassName="mx-auto w-full max-w-6xl">
      {isLoading ? (
        <p className="text-muted-foreground">Učitavanje…</p>
      ) : students.length === 0 ? (
        <EmptyState
          icon={AcademicCapIcon}
          tone="blue"
          title="Raspored časova, smene i raspusti"
          description="Označi dete kao učenika u Porodici. Zatim mu postavi smenu i upiši predmete - vremena časova se dalje računaju sama, iz satnice zvona."
          action={{
            label: "Otvori Porodicu",
            onClick: () => void navigate({ to: "/settings", search: { tab: "family" } }),
          }}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
          <div className="space-y-3 lg:order-2">
            {selected && anchor && outlook && nextOutlook ? (
              <SchoolShiftCard
                member={selected}
                outlook={outlook}
                next={nextOutlook}
                isAlternating={anchor.is_alternating}
                todaySpan={todaySpan}
                nextBreakHit={nextBreakHit}
                onEditShift={() => openOptions({ kind: "shift", personId: selected.id })}
              />
            ) : null}
            {selected && hasTimetable ? (
              <SchoolDayCard
                weekStart={weekStart}
                dayCount={dayCount}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                blocks={school.blocks}
                bigBreakAfter={bigBreakAfter}
                todayIndex={todayIndex}
                nowMinutes={nowMinutes}
                breakLabel={school.breakDays.get(selectedDate)}
                onEdit={() =>
                  openOptions({
                    kind: "timetable",
                    personId: selected.id,
                    variant: outlook?.variant,
                    day: selectedDay,
                  })
                }
              />
            ) : null}
          </div>

          <div className="space-y-3 lg:order-1">
            {selected && hasTimetable && visibleSlots.length > 0 && maxPeriod > 0 ? (
              <div className="hidden space-y-1.5 lg:block">
                <SchoolWeekTable
                  weekStart={weekStart}
                  dayCount={dayCount}
                  slots={visibleSlots}
                  blocks={school.blocks}
                  color={selected.color ?? "var(--accent)"}
                  todayIndex={todayIndex}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  onEditDay={(day) =>
                    openOptions({
                      kind: "timetable",
                      personId: selected.id,
                      variant: outlook?.variant,
                      day,
                    })
                  }
                  breakDays={school.breakDays}
                  nowMinutes={nowMinutes}
                />
                <p className="px-1 text-[11.5px] font-normal text-muted-foreground">
                  Časovi se i dalje vide u nedeljnoj mreži na Aktivnostima i u Kalendaru {">"}{" "}
                  Nedelja.
                </p>
              </div>
            ) : null}

            {selected && !hasTimetable ? (
              <EmptyState
                icon={BookOpenIcon}
                tone="blue"
                title="Još nema rasporeda"
                description="Upiši predmete po danima - jedan po liniji. Vreme svakog časa se računa iz satnice zvona i pomera se samo kad se smena promeni."
                action={{
                  label: "Upiši raspored",
                  onClick: () => openOptions({ kind: "timetable", personId: selected.id }),
                }}
              />
            ) : null}

            {/* A raspust week is the one case where an empty timetable is the
                correct answer - say which one, or the page just looks broken. */}
            {selected && hasTimetable && maxPeriod === 0 ? (
              <EmptyState
                variant="filter"
                title="Ove nedelje nema časova"
                description={
                  weekBreakNote
                    ? `${weekBreakNote} - raspored se vraća kad se raspust završi.`
                    : "Za ovu nedelju u rasporedu nema nijednog upisanog časa."
                }
              />
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <BellScheduleCard
                bell={bell}
                initialBand={outlook?.usesPredcas ? "predcas" : (outlook?.band ?? "morning")}
                onEdit={() => openOptions({ kind: "bell" })}
              />
              <SchoolBreaksCard
                breaks={breaks}
                memberIdsByBreak={memberIdsByBreak}
                students={students}
                today={today.str}
                onAdd={() => openOptions({ kind: "breakForm", breakId: null })}
                onEdit={(breakId) => openOptions({ kind: "breakForm", breakId })}
              />
            </div>
          </div>
        </div>
      )}

      <SchoolOptionsSheet
        key={options.nonce}
        open={options.view !== null}
        onOpenChange={(next) => {
          if (!next) setOptions((prev) => ({ ...prev, view: null }));
        }}
        initialView={options.view}
        members={members}
        anchorsByPersonId={anchorsByPersonId}
        timeBandByPerson={timeBandByPerson}
        entries={entries}
        bell={bell}
      />
    </AppScreen>
  );
}
