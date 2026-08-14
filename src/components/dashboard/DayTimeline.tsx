import { useMemo } from "react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ArrowPathIcon,
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  CheckCircleIcon,
  GlobeAltIcon,
  MapPinIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

import { Amount } from "@/components/common/Amount";
import { PersonDot } from "@/components/common/ItemCard";
import { useMinuteTick } from "@/components/dashboard/agendaCalendarShared";
import { TaskRow, type TaskAgendaItem } from "@/components/tasks/TaskRow";
import { cn } from "@/lib/cn";
import type { AgendaItem } from "@/hooks/useAgenda";
import { agendaItemKey } from "@/hooks/useAgenda";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useMemberEmoji } from "@/hooks/useMemberAvatarStyle";
import type { Profile } from "@/types/database";
import { fallbackColorForProfile } from "@/utils/activity";
import { currentAge } from "@/utils/birthday";
import { getDisplayName } from "@/utils/identity";
import { isUpcomingPaymentOccurrence } from "@/utils/payment";
import { taskRecurrenceLabel } from "@/utils/task";
import { nowLineIndex, splitDayTimeline } from "@/utils/dayTimeline";

/**
 * Danas as ONE timeline (redizajn 2.0 merges the old list and day-calendar
 * views, so there is nothing left to toggle between).
 *
 * Reading order top to bottom:
 *   1. all-day and multi-day items as chips - they have no place on a clock;
 *   2. the timed items, each on its own row with the time in a left gutter,
 *      with a "Sada · HH:mm" line dropped in at the current time and everything
 *      before it dimmed, so "what is next" is the first thing the eye lands on;
 *   3. tasks with no time - "sometime today", so not on the clock, but still
 *      the one band on this screen you are meant to ACT on, which is why it
 *      sits above the money and its rows carry the completion circle;
 *   4. payments due today - due today but not tied to an hour, so they'd be
 *      guesswork on the clock and noise in the middle of it.
 *
 * Unlike the old day calendar this is NOT proportional: an hour of empty
 * afternoon costs no vertical space. On a phone that was mostly blank grid.
 */

export type DayTimelineProps = {
  items: ReadonlyArray<AgendaItem>;
  onSelect: (item: AgendaItem) => void;
  /** Rendered when the day has nothing at all (the caller owns the copy). */
  emptyState?: ReactNode;
};

export function DayTimeline({ items, onSelect, emptyState }: DayTimelineProps) {
  const now = useMinuteTick();
  const { byId } = useFamilyMembers();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const { chips, timed, payments } = useMemo(
    () => splitDayTimeline(items, nowMinutes),
    [items, nowMinutes],
  );

  // An untimed task lands in `chips` (it has no range), but a "ceo dan" chip is
  // the wrong shape for it: a chore has to be tickable, and the circle only fits
  // on a full row. So it gets a band of its own further down.
  const { spanChips, untimedTasks } = useMemo(() => {
    const spans: AgendaItem[] = [];
    const tasks: TaskAgendaItem[] = [];
    for (const item of chips) {
      if (item.kind === "task") tasks.push(item);
      else spans.push(item);
    }
    return { spanChips: spans, untimedTasks: tasks };
  }, [chips]);

  if (chips.length === 0 && timed.length === 0 && payments.length === 0) {
    return <>{emptyState}</>;
  }

  const nextIndex = nowLineIndex(timed, nowMinutes);

  return (
    <div>
      {spanChips.map((item) => (
        <SpanChip
          key={agendaItemKey(item)}
          item={item}
          members={byId}
          onClick={() => onSelect(item)}
        />
      ))}

      {timed.map((entry, index) => (
        <div key={agendaItemKey(entry.item)}>
          {index === nextIndex ? <NowLine now={now} /> : null}
          <div
            className={cn(
              "mb-2 flex items-stretch gap-2.5",
              // A task is deliberately exempt from the elapsed-row fade: an
              // appointment at 09:00 really is over by noon, but a reminder is
              // not, and fading it would retire the one row still asking for
              // something. Its own done state dims it instead.
              entry.past && entry.item.kind !== "task" && "opacity-40",
            )}
          >
            <div className="w-11 flex-none pt-3 text-right text-[12.5px] font-bold text-muted-foreground tabular-nums">
              {entry.startTime}
            </div>
            {entry.item.kind === "task" ? (
              // A timed task IS its minute and nothing more, so the gutter says
              // when and the row carries the circle instead of a second clock.
              <div className="min-w-0 flex-1">
                <TaskRow item={entry.item} onClick={() => onSelect(entry.item)} showTime={false} />
              </div>
            ) : (
              <TimelineCard
                item={entry.item}
                members={byId}
                onClick={() => onSelect(entry.item)}
                // The left gutter already anchors the start time, so the card's
                // right side only carries the end - repeating the start there
                // (as the prototype does) reads as noise on a phone.
                side={
                  entry.endTime ? (
                    <span className="text-[12.5px] font-normal text-muted-foreground tabular-nums">
                      do {entry.endTime}
                    </span>
                  ) : null
                }
              />
            )}
          </div>
        </div>
      ))}

      {untimedTasks.length > 0 ? (
        <>
          <GroupHeader>Zadaci danas</GroupHeader>
          {untimedTasks.map((item) => (
            <div key={agendaItemKey(item)} className="mb-2">
              <TaskRow item={item} onClick={() => onSelect(item)} />
            </div>
          ))}
        </>
      ) : null}

      {payments.length > 0 ? (
        <>
          <GroupHeader>Plaćanja danas</GroupHeader>
          {/* No time gutter down here: these rows sit under their own header,
              below the clock, so the reserved 44px read as the card being
              chopped off on the left rather than as alignment. */}
          {payments.map((item) => (
            <div key={agendaItemKey(item)} className="mb-2 flex items-stretch">
              <TimelineCard item={item} members={byId} onClick={() => onSelect(item)} />
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function GroupHeader({ children }: { children: ReactNode }) {
  return (
    <div className="mx-1 mt-4 mb-2 text-[11.5px] font-bold tracking-wider text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function NowLine({ now }: { now: Date }) {
  const label = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  return (
    <div className="my-3 flex items-center gap-2" aria-hidden="true">
      <span className="flex-none text-[10.5px] font-bold tracking-wider text-accent-deep uppercase">
        Sada · {label}
      </span>
      <span className="h-0.5 flex-1 rounded-full bg-accent opacity-65" />
      <span className="size-2 flex-none rounded-full bg-accent" />
    </div>
  );
}

/** Per-person tinted square (activities), or a semantic one per type. */
function TypeSquare({ color, tone, icon: Icon }: { color?: string; tone: Tone; icon: IconType }) {
  return (
    <span
      className={cn(
        "grid size-[42px] flex-none place-items-center rounded-lg",
        !color && TONE_SQUARE[tone],
      )}
      style={
        color ? { background: `color-mix(in srgb, ${color} 14%, var(--card))`, color } : undefined
      }
    >
      <Icon className="size-5" />
    </span>
  );
}

type Tone = "accent" | "info" | "warn" | "pos" | "task";
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const TONE_SQUARE: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-deep",
  info: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
  pos: "bg-pos-soft text-pos",
  task: "bg-task-soft text-task",
};

/** A person's colour dot, appended to a title. */
function Pill({ tone, children }: { tone: Tone | "neg"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap",
        tone === "accent" && "bg-accent-soft text-accent-deep",
        tone === "info" && "bg-info-soft text-info",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "pos" && "bg-pos-soft text-pos",
        tone === "task" && "bg-task-soft text-task",
        tone === "neg" && "bg-neg-soft text-neg",
      )}
    >
      {children}
    </span>
  );
}

/**
 * One card in the timeline. The type-specific bits (square colour, title,
 * meta line) are decided here so every kind lands in the same frame.
 */
function TimelineCard({
  item,
  members,
  onClick,
  side,
}: {
  item: AgendaItem;
  members: Map<string, Profile>;
  onClick: () => void;
  side?: ReactNode;
}) {
  const memberEmoji = useMemberEmoji();
  const content = cardContent(item, members, memberEmoji);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center gap-2.5 rounded-xl border border-border bg-card p-3 text-left shadow-card transition-transform active:scale-[0.98]"
    >
      {content.square}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5 text-[15px] leading-tight font-semibold tracking-tight">
          {content.title}
        </span>
        {content.meta ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] leading-snug font-normal text-muted-foreground">
            {content.meta}
          </span>
        ) : null}
      </span>
      {side || content.side ? (
        <span className="flex flex-none flex-col items-end gap-0.5">{side ?? content.side}</span>
      ) : null}
    </button>
  );
}

function memberName(members: Map<string, Profile>, id: string): string {
  const person = members.get(id);
  if (!person) return "";
  return (
    getDisplayName({
      firstName: person.first_name,
      lastName: person.last_name,
      email: null,
    }) || "Bez imena"
  );
}

function cardContent(
  item: AgendaItem,
  members: Map<string, Profile>,
  /** From `useMemberEmoji` - returns undefined while the viewer is on initials. */
  memberEmoji: (member: Profile | undefined, personId?: string) => string | undefined,
): { square: ReactNode; title: ReactNode; meta: ReactNode; side?: ReactNode } {
  switch (item.kind) {
    case "activity": {
      const color = item.person?.color ?? fallbackColorForProfile(item.block.personId);
      const name = memberName(members, item.block.personId) || "-";
      return {
        square: <TypeSquare color={color} tone="accent" icon={SparklesIcon} />,
        title: (
          <>
            {item.activity?.name ?? "Aktivnost"}
            <PersonDot
              color={color}
              emoji={memberEmoji(item.person ?? undefined, item.block.personId)}
            />
          </>
        ),
        meta: (
          <>
            {name}
            {item.activity?.description ? <> · {item.activity.description}</> : null}
          </>
        ),
      };
    }
    case "event": {
      const names = item.personIds.map((id) => memberName(members, id)).filter(Boolean);
      return {
        square: <TypeSquare tone="accent" icon={CalendarIcon} />,
        title: (
          <>
            {item.event.name}
            {item.personIds.map((id) => (
              <PersonDot
                key={id}
                color={members.get(id)?.color ?? fallbackColorForProfile(id)}
                emoji={memberEmoji(members.get(id), id)}
              />
            ))}
          </>
        ),
        meta: (
          <>
            {item.totalDays > 1 ? (
              <Pill tone="accent">
                Dan {item.dayIndex}/{item.totalDays}
              </Pill>
            ) : null}
            {item.event.description ?? (names.length > 0 ? names.join(", ") : null)}
          </>
        ),
      };
    }
    case "external": {
      return {
        square: <TypeSquare tone="info" icon={GlobeAltIcon} />,
        title: <>{item.event.title ?? "(bez naslova)"}</>,
        meta: (
          <>
            {item.event.location ? (
              <>
                <MapPinIcon className="size-3" />
                {item.event.location} ·{" "}
              </>
            ) : null}
            <Pill tone="info">Google</Pill>
          </>
        ),
      };
    }
    case "payment": {
      const upcoming = isUpcomingPaymentOccurrence(item);
      return {
        square: <TypeSquare tone="warn" icon={BanknotesIcon} />,
        title: (
          <>
            {item.payment.name}
            {item.personIds.map((id) => (
              <PersonDot
                key={id}
                color={members.get(id)?.color ?? fallbackColorForProfile(id)}
                emoji={memberEmoji(members.get(id), id)}
              />
            ))}
          </>
        ),
        meta: (
          <>
            {item.payment.is_recurring ? (
              <>
                <ArrowPathIcon className="size-3" />
                ponavlja se ·{" "}
              </>
            ) : null}
            <Pill tone={upcoming ? "accent" : "warn"}>
              {upcoming ? "Nadolazeće" : "Dospeva danas"}
            </Pill>
          </>
        ),
        side: (
          <span className="text-[15px] font-bold tabular-nums">
            <Amount value={item.payment.amount} round />
          </span>
        ),
      };
    }
    case "task": {
      // Unreachable in practice: every band above routes a task to `TaskRow`,
      // which is the only shape that can carry the completion circle. Kept so
      // the switch stays total, and shaped so a future band that forgets still
      // renders something honest.
      const recurrence = taskRecurrenceLabel(item.task);
      return {
        square: <TypeSquare tone="task" icon={CheckCircleIcon} />,
        title: (
          <>
            {item.task.name}
            {item.assigneeIds.map((id) => (
              <PersonDot
                key={id}
                color={members.get(id)?.color ?? fallbackColorForProfile(id)}
                emoji={memberEmoji(members.get(id), id)}
              />
            ))}
          </>
        ),
        meta: recurrence ? (
          <>
            <ArrowPathIcon className="size-3" />
            {recurrence}
          </>
        ) : null,
      };
    }
    case "birthday": {
      const nextAge = currentAge(item.birthday.birth_date) + 1;
      return {
        square: <TypeSquare tone="pos" icon={CakeIcon} />,
        title: <>{item.birthday.name}</>,
        meta: <>{nextAge}. rođendan</>,
      };
    }
  }
}

/** All-day and multi-day items, above the clock. */
function SpanChip({
  item,
  members,
  onClick,
}: {
  item: AgendaItem;
  members: Map<string, Profile>;
  onClick: () => void;
}) {
  const memberEmoji = useMemberEmoji();
  const content = cardContent(item, members, memberEmoji);
  const sub =
    item.kind === "event" && item.totalDays > 1
      ? `Dan ${item.dayIndex}/${item.totalDays}`
      : item.kind === "birthday"
        ? `${currentAge(item.birthday.birth_date) + 1}. rođendan`
        : "ceo dan";

  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-accent bg-accent-soft px-3 py-2.5 text-left text-[13px] font-semibold transition-transform active:scale-[0.98]"
    >
      <span className="text-accent-deep">
        {item.kind === "birthday" ? (
          <CakeIcon className="size-[15px]" />
        ) : item.kind === "external" ? (
          <GlobeAltIcon className="size-[15px]" />
        ) : (
          <CalendarIcon className="size-[15px]" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{content.title}</span>
      <span className="flex-none text-xs font-normal text-muted-foreground">{sub}</span>
    </button>
  );
}
