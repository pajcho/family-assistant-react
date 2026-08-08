import { Fragment } from "react";

import {
  KidCard,
  KidCardMain,
  KidCardMeta,
  KidCardSide,
  KidCardTitle,
  KidTile,
} from "@/components/kid/KidUi";
import { emojiForSubject } from "@/components/kid/kidEmoji";
import { classesWord } from "@/components/kid/kidCopy";
import type { ResolvedSchoolBlock } from "@/utils/schoolTimetable";

/**
 * The school pieces of the kid shell.
 *
 * The prototype's key idea: a child does not read a clock grid, they count
 * classes. So this is a numbered LADDER - "1. Matematika", "2. Srpski", the
 * veliki odmor as a dashed divider in between - with the times demoted to a
 * meta line and a pulsing "SADA" badge on whichever class is happening now.
 */

// ---------------------------------------------------------------------------
// Day pills (inside the gradient header on Raspored)
// ---------------------------------------------------------------------------

export function KidDayPills({
  days,
  selected,
  todayISO,
  onSelect,
}: {
  /** Mon-Fri, as `{ date, label }`. */
  days: ReadonlyArray<{ date: string; label: string }>;
  selected: string;
  todayISO: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="mt-3.5 flex gap-1.5">
      {days.map((day) => {
        const active = day.date === selected;
        return (
          <button
            key={day.date}
            type="button"
            onClick={() => onSelect(day.date)}
            aria-pressed={active}
            className={`kid-on-gradient relative flex-1 rounded-2xl pt-2.5 pb-3 text-[13px] font-semibold transition-transform duration-100 active:scale-[0.93] ${
              active ? "bg-white text-[var(--k-accent-strong)]" : "bg-white/20 text-white"
            }`}
          >
            {day.label}
            {day.date === todayISO ? (
              <span
                aria-hidden="true"
                className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current opacity-80"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export function KidSchoolLadder({
  blocks,
  bigBreakAfterPeriod,
  bigBreakRange,
  nowPeriod,
}: {
  blocks: ReadonlyArray<ResolvedSchoolBlock>;
  bigBreakAfterPeriod: number | null;
  bigBreakRange: string | null;
  /** Period index happening right now, or null. */
  nowPeriod: number | null;
}) {
  return (
    <ol className="list-none">
      {blocks.map((block) => {
        const isNow = block.periodIndex === nowPeriod;
        const showBreak = bigBreakAfterPeriod === block.periodIndex;
        return (
          <Fragment key={block.entryId}>
            <li>
              <KidCard highlighted={isNow}>
                <span
                  aria-hidden="true"
                  className="grid size-[30px] flex-none place-items-center rounded-xl bg-[var(--k-soft)] text-[12.5px] font-semibold text-[var(--k-accent)]"
                >
                  {block.periodIndex}.
                </span>
                <KidTile emoji={emojiForSubject(block.subject)} />
                <KidCardMain>
                  <KidCardTitle>{block.subject}</KidCardTitle>
                  <KidCardMeta>
                    {block.startTime} - {block.endTime}
                  </KidCardMeta>
                </KidCardMain>
                {isNow ? (
                  <KidCardSide>
                    <span className="kid-pulse rounded-full bg-[var(--k-accent)] px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--k-accent-ink)]">
                      SADA
                    </span>
                  </KidCardSide>
                ) : null}
              </KidCard>
            </li>
            {showBreak ? (
              <li
                aria-label={`Veliki odmor ${bigBreakRange ?? ""}`}
                className="mx-2 mt-0.5 mb-3 flex items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-dashed border-[var(--k-line)] p-2 text-[12px] font-medium text-[var(--k-sub)]"
              >
                <span aria-hidden="true">🥪</span>
                Veliki odmor{bigBreakRange ? ` · ${bigBreakRange}` : ""}
              </li>
            ) : null}
          </Fragment>
        );
      })}
    </ol>
  );
}

/** The reassurance at the bottom of Raspored - it is not the child's to fix. */
export function KidSchoolFooter() {
  return (
    <p className="px-5 pt-3 pb-1 text-center text-[11.5px] leading-relaxed font-normal text-[var(--k-sub)]">
      Raspored unose roditelji u glavnoj aplikaciji.
      <br />
      Ovde ne možeš ništa da pokvariš 😄
    </p>
  );
}

// ---------------------------------------------------------------------------
// "Škola danas" - the first card on the Danas screen
// ---------------------------------------------------------------------------

export function KidSchoolTodayCard({
  blocks,
  nowPeriod,
  onOpen,
}: {
  blocks: ReadonlyArray<ResolvedSchoolBlock>;
  nowPeriod: number | null;
  onOpen: () => void;
}) {
  if (blocks.length === 0) return null;

  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const now = nowPeriod ? blocks.find((b) => b.periodIndex === nowPeriod) : undefined;
  const meta = now
    ? `${blocks.length} ${classesWord(blocks.length)} · sada: ${now.subject} ${emojiForSubject(now.subject)}`
    : `${blocks.length} ${classesWord(blocks.length)}`;

  return (
    <KidCard onClick={onOpen} gradientBorder ariaLabel="Škola danas - otvori raspored">
      <KidTile emoji="🏫" />
      <KidCardMain>
        <KidCardTitle>Škola danas</KidCardTitle>
        <KidCardMeta>{meta}</KidCardMeta>
      </KidCardMain>
      <KidCardSide>
        <span className="text-[15.5px] font-semibold text-[var(--k-ink)]">{first.startTime}</span>
        <span className="text-[11px] font-normal text-[var(--k-sub)]">do {last.endTime}</span>
      </KidCardSide>
    </KidCard>
  );
}
