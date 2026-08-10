import { Fragment, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ClockIcon,
  MoonIcon,
  PencilSquareIcon,
  PlusIcon,
  SunIcon,
} from "@heroicons/react/24/outline";

import { IconButton } from "@/components/common/IconButton";
import { Pill } from "@/components/common/Pill";
import { Segmented } from "@/components/common/Segmented";
import { formatBreakRange } from "@/components/school/SchoolBreaksPanel";
import { cn } from "@/lib/cn";
import type { BellSchedule, Profile, SchoolBreak, SchoolShift } from "@/types/database";
import { SHIFT_LABELS, fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { serbianPlural } from "@/utils/plural";
import { computeBellGrid } from "@/utils/schoolTimetable";
import { daysUntilBreak, type NextBreakHit, type SchoolWeekOutlook } from "@/utils/schoolOverview";

/**
 * The three cards that frame the timetable on the school screen: which shift
 * this week is, when the bells ring, and when the next raspust lands.
 *
 * They are siblings in one file because they only ever appear together, as one
 * column, and each is small enough that splitting them would cost more in
 * import noise than it buys in isolation.
 */

// ---------------------------------------------------------------------------
// Smena - the card the page opens with
// ---------------------------------------------------------------------------

export type SchoolShiftCardProps = {
  member: Profile;
  /** This week's resolved variant / band / start time. */
  outlook: SchoolWeekOutlook;
  /** Next week's, for the "what changes" line. */
  next: SchoolWeekOutlook;
  isAlternating: boolean;
  /** Today's first and last class ("08:00 - 12:20"), when the week is current. */
  todaySpan: string | null;
  nextBreakHit: NextBreakHit | null;
  onEditShift: () => void;
};

export function SchoolShiftCard({
  member,
  outlook,
  next,
  isAlternating,
  todaySpan,
  nextBreakHit,
  onEditShift,
}: SchoolShiftCardProps) {
  const name =
    getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
    "Bez imena";
  const Icon = outlook.band === "morning" ? SunIcon : MoonIcon;

  return (
    <section className="rounded-xl border border-border bg-accent-soft/55 p-3.5 shadow-card">
      <div className="flex items-start gap-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] leading-tight font-bold tracking-[-0.01em]">
            {SHIFT_LABELS[outlook.band]}
          </h2>
          <p className="mt-px truncate text-xs font-normal text-muted-foreground">
            {todaySpan ? `${name} · danas ${todaySpan}` : name}
          </p>
        </div>
        <IconButton
          icon={PencilSquareIcon}
          size="sm"
          aria-label={`Podesi smenu - ${name}`}
          onClick={onEditShift}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill>{isAlternating ? `Nedelja ${outlook.variant}` : "Bez A/B rotacije"}</Pill>
        {outlook.usesPredcas ? (
          <Pill tone="muted">
            <ClockIcon className="size-3" />
            pred-čas od {outlook.startTime}
          </Pill>
        ) : null}
        {nextBreakHit ? (
          <Pill tone="warn">
            <SunIcon className="size-3" />
            {nextBreakHit.ongoing
              ? `${nextBreakHit.brk.name} traje`
              : `${nextBreakHit.brk.name} za ${nextBreakHit.daysUntil} ${serbianPlural(
                  nextBreakHit.daysUntil,
                  { one: "dan", few: "dana", many: "dana" },
                )}`}
          </Pill>
        ) : null}
      </div>

      <p className="mt-3 flex items-start gap-2 border-t border-border pt-2.5 text-[12.5px] font-normal text-muted-foreground">
        <ArrowPathIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {isAlternating ? (
            <>
              Sledeća nedelja:{" "}
              <span className="font-semibold text-foreground">
                {SHIFT_LABELS[next.band].toLowerCase()}
              </span>
              , nedelja {next.variant} · od {next.startTime}
            </>
          ) : (
            <>Smena se ne menja po nedeljama.</>
          )}
        </span>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Satnica zvona
// ---------------------------------------------------------------------------

type BandChoice = "morning" | "afternoon" | "predcas";

const BAND_OPTIONS: ReadonlyArray<{ value: BandChoice; label: string }> = [
  { value: "morning", label: "Jutarnja" },
  { value: "afternoon", label: "Popodnevna" },
  { value: "predcas", label: "Pred-čas" },
];

export type BellScheduleCardProps = {
  bell: BellSchedule;
  /** Which band to open on - the shown child's, so it starts on what matters. */
  initialBand: BandChoice;
  onEdit: () => void;
};

export function BellScheduleCard({ bell, initialBand, onEdit }: BellScheduleCardProps) {
  const [band, setBand] = useState<BandChoice>(initialBand);
  const slots = useMemo(() => {
    const resolved: SchoolShift = band === "morning" ? "morning" : "afternoon";
    return computeBellGrid(bell, resolved, band === "predcas");
  }, [bell, band]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-start gap-2 px-[13px] pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">Satnica zvona</h2>
          <p className="mt-px truncate text-[11.5px] font-normal text-muted-foreground">
            čas {bell.period_minutes} min · mali odmor {bell.small_break_minutes} · veliki{" "}
            {bell.big_break_minutes}
          </p>
        </div>
        <IconButton
          icon={PencilSquareIcon}
          size="sm"
          aria-label="Uredi satnicu zvona"
          onClick={onEdit}
        />
      </div>

      <div className="px-[13px] pt-2.5">
        <Segmented
          options={BAND_OPTIONS}
          value={band}
          onChange={setBand}
          ariaLabel="Smena za pregled satnice"
        />
      </div>

      <ol className="px-[13px] py-2">
        {slots.map((slot) => (
          <Fragment key={slot.periodIndex}>
            <li className="flex items-center gap-2.5 py-1">
              <span className="w-4 shrink-0 text-right text-[11.5px] font-semibold text-muted-foreground tabular-nums">
                {slot.periodIndex}.
              </span>
              <span className="text-[12.5px] font-normal tabular-nums">
                {slot.startTime} - {slot.endTime}
              </span>
            </li>
            {slot.bigBreakAfter && slot.periodIndex < slots.length ? (
              <li
                aria-hidden="true"
                className="flex items-center gap-2 py-0.5 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
              >
                <span className="h-px flex-1 bg-border" />
                veliki odmor
                <span className="h-px flex-1 bg-border" />
              </li>
            ) : null}
          </Fragment>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Raspusti
// ---------------------------------------------------------------------------

export type SchoolBreaksCardProps = {
  breaks: ReadonlyArray<SchoolBreak>;
  memberIdsByBreak: ReadonlyMap<string, ReadonlySet<string>>;
  students: ReadonlyArray<Profile>;
  /** Today (YYYY-MM-DD) - what the countdown counts from. */
  today: string;
  onAdd: () => void;
  onEdit: (breakId: string) => void;
};

export function SchoolBreaksCard({
  breaks,
  memberIdsByBreak,
  students,
  today,
  onAdd,
  onEdit,
}: SchoolBreaksCardProps) {
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  // Nearest first: the list answers "when do they next get days off", and a
  // fixed order would bury it under whichever raspust was created first.
  const sorted = useMemo(() => {
    return breaks
      .map((brk) => ({ brk, days: daysUntilBreak(brk, today) }))
      .sort((a, b) => a.days - b.days);
  }, [breaks, today]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-start gap-2 px-[13px] pt-3 pb-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">Raspusti</h2>
          <p className="mt-px truncate text-[11.5px] font-normal text-muted-foreground">
            tokom raspusta časovi se ne prikazuju
          </p>
        </div>
        <IconButton icon={PlusIcon} size="sm" aria-label="Dodaj raspust" onClick={onAdd} />
      </div>

      {sorted.length === 0 ? (
        <p className="px-[13px] pt-1 pb-3.5 text-[13px] font-normal text-muted-foreground">
          Još nema raspusta. Dodaj letnji, zimski i prolećni - važe svake godine.
        </p>
      ) : (
        <ul className="pb-1">
          {sorted.map(({ brk, days }, index) => {
            const scoped = memberIdsByBreak.get(brk.id);
            const named =
              scoped && scoped.size > 0
                ? [...scoped].map((id) => studentById.get(id)).filter((p): p is Profile => !!p)
                : [];
            return (
              <li key={brk.id}>
                <button
                  type="button"
                  onClick={() => onEdit(brk.id)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-border px-[13px] py-2.5 text-left last:border-b-0",
                    "transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{brk.name}</span>
                    <span className="mt-px flex flex-wrap items-center gap-x-1.5 text-[11.5px] font-normal text-muted-foreground">
                      <span>{formatBreakRange(brk)}</span>
                      <span aria-hidden="true">·</span>
                      {named.length === 0 ? (
                        <span>sva deca</span>
                      ) : (
                        named.map((person) => (
                          <span key={person.id} className="inline-flex items-center gap-1">
                            <span
                              className="inline-block size-2 rounded-full"
                              style={{
                                backgroundColor: person.color ?? fallbackColorForProfile(person.id),
                              }}
                              aria-hidden="true"
                            />
                            {person.first_name ||
                              getDisplayName({
                                firstName: person.first_name,
                                lastName: person.last_name,
                                email: null,
                              }) ||
                              "Bez imena"}
                          </span>
                        ))
                      )}
                    </span>
                  </span>
                  {/* Only the nearest one gets a countdown - a column of them
                      would be five numbers competing instead of one answer. */}
                  {index === 0 && Number.isFinite(days) ? (
                    <Pill tone="warn">
                      {days === 0
                        ? "traje"
                        : `za ${days} ${serbianPlural(days, {
                            one: "dan",
                            few: "dana",
                            many: "dana",
                          })}`}
                    </Pill>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
