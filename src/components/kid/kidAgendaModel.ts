import type { AgendaItem } from "@/hooks/useAgenda";
import type { Task } from "@/types/database";
import type { AgendaKind } from "@/utils/agendaFilters";
import { filterAgendaItems } from "@/utils/agendaFilters";
import type { ResolvedActivityBlock } from "@/utils/activity";
import { normalizeTime, toMondayFirstDow } from "@/utils/activity";
import { parseDate } from "@/utils/date";
import type { KidTagTone } from "@/components/kid/KidUi";
import {
  countdownLabel,
  daysBetween,
  formatKidLongDate,
  formatKidShortDate,
  pluralSr,
  weekdayGenitive,
  weekdayName,
} from "@/components/kid/kidCopy";
import { emojiForAgendaItem } from "@/components/kid/kidEmoji";

/**
 * Turns an `AgendaItem` into what a child actually sees - a card model and a
 * detail model. Pure and total, so both the card and its sheet stay in step and
 * the wording is unit-testable without rendering anything.
 *
 * The agenda layer is shared with the grown-up app, so this is where the two
 * vocabularies part ways: no amounts, no "Google", no participant lists, and
 * dates give way to countdowns wherever a countdown says more.
 */

export interface KidCardModel {
  emoji: string;
  title: string;
  /** One short line under the title, or null. */
  meta: string | null;
  /** The news line under the meta ("pomereno sa 18:00"), or null. */
  moved: string | null;
  /** Start time on the right ("17:00"), or null for all-day things. */
  time: string | null;
  /** Small line under the time ("do 18:00"). */
  timeMeta: string | null;
  tag: { tone: KidTagTone; label: string } | null;
  /** Cancelled: struck-through title, muted card, an "otkazano" chip. */
  canceled: boolean;
  /**
   * A chore this child has ticked off: struck-through title and a filled
   * circle. Deliberately its own flag rather than reusing `canceled` - a
   * finished chore is the child's own doing and should feel like a small win,
   * while a cancellation is news from a grown-up and mutes the whole card.
   */
  done: boolean;
}

export interface KidDetailModel {
  emoji: string;
  title: string;
  rows: { icon: string; text: string }[];
}

export interface KidAgendaContext {
  todayISO: string;
  /**
   * Per-child completion for a chore instance, from `useKidTasks`. An agenda
   * item's own `isDone` answers for the WHOLE occurrence, which is the wrong
   * answer whenever a chore is ticked per assignee, so the kid layer asks the
   * hook instead. `undefined` (no chores on screen, or a unit test) falls back
   * to the item's own answer, so this stays a pure function either way.
   */
  taskDone?: (taskId: string, occurrenceDate: string) => boolean | undefined;
}

/**
 * The only agenda kinds a child ever sees. RLS already makes payments and
 * mirrored Google events invisible to a kid session, so this is belt and
 * braces - but it also keeps the shell honest if a future kind is added to the
 * agenda layer and nobody thinks about children that day.
 */
export const KID_AGENDA_KINDS: ReadonlySet<AgendaKind> = new Set<AgendaKind>([
  "activity",
  "task",
  "event",
  "birthday",
]);

/**
 * The agenda a child actually sees: their kinds, their people, their birthdays.
 *
 * The birthday pass is the reason this exists rather than a bare
 * `filterAgendaItems` call at each screen. `matchesAgendaFilter` exempts
 * birthdays from the person filter on purpose - a birthday has no participants,
 * and the grown-up app wants every birthday to survive "show me only Vuk". That
 * is right upstairs and wrong down here: it would hand a child (or a parent
 * previewing one) every birthday the SESSION can read instead of the ones the
 * parent ticked for them. So the exemption is undone here, in the kid layer,
 * leaving `matchesAgendaFilter`'s semantics untouched for everyone else.
 *
 * `visibleBirthdayIds` comes from `useKidBirthdayVisibility`, and an empty set
 * legitimately means "no birthdays" - it must never be read as "no filter".
 *
 * Chores need no pass of their own: `agendaItemPersonIds` returns a task's
 * assignees, and an unassigned task is family-wide, so the person filter already
 * drops both other people's chores and the whole shopping list. RLS says the
 * same to a real kid session; the person filter is what makes a parent's preview
 * agree with it.
 */
export function filterKidAgendaItems(
  items: AgendaItem[],
  personIds: ReadonlySet<string>,
  visibleBirthdayIds: ReadonlySet<string>,
): AgendaItem[] {
  return filterAgendaItems(items, { kinds: KID_AGENDA_KINDS, personIds }).filter(
    (item) => item.kind !== "birthday" || visibleBirthdayIds.has(item.birthday.id),
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Sheet rows start a sentence; card lines do not. Null passes through. */
function capitalizeOrNull(text: string | null): string | null {
  return text === null ? null : capitalize(text);
}

/** "Danas" / "Sutra" / "Prekosutra" / "Sreda, 7. oktobar" - starts a sentence. */
export function whenPrefix(dateISO: string, todayISO: string): string {
  const days = daysBetween(todayISO, dateISO);
  if (days === 0) return "Danas";
  if (days === 1) return "Sutra";
  if (days === 2) return "Prekosutra";
  return capitalize(formatKidLongDate(dateISO));
}

/**
 * Recurrence in a child's words. Two tables because Serbian needs both cases:
 * "Svakog ponedeljka" for the weekly line, "sredom" when a week interval has to
 * be named first. Nothing here is derived - the forms are irregular enough that
 * a rule would only produce plausible-looking mistakes.
 */
const EVERY_WEEK_PHRASES: readonly string[] = [
  "Svakog ponedeljka",
  "Svakog utorka",
  "Svake srede",
  "Svakog četvrtka",
  "Svakog petka",
  "Svake subote",
  "Svake nedelje",
];

const DAY_ADVERBS: readonly string[] = [
  "ponedeljkom",
  "utorkom",
  "sredom",
  "četvrtkom",
  "petkom",
  "subotom",
  "nedeljom",
];

/** "Svake druge nedelje, sredom" / "Na svake 3 nedelje, petkom". */
function everyNWeeksLine(intervalWeeks: number, days: string): string {
  if (intervalWeeks === 2) return `Svake druge nedelje, ${days}`;
  // 2-4 take the accusative ("svake 3 nedelje"), 5+ the genitive
  // ("svakih 5 nedelja") - the same one/few/many split as everywhere else.
  const span = pluralSr(
    intervalWeeks,
    `svake ${intervalWeeks} nedelje`,
    `svake ${intervalWeeks} nedelje`,
    `svakih ${intervalWeeks} nedelja`,
  );
  return `Na ${span}, ${days}`;
}

export function repeatLine(dayOfWeek: number, intervalWeeks: number): string {
  const adverb = DAY_ADVERBS[dayOfWeek] ?? "svake nedelje";
  if (intervalWeeks <= 1) return EVERY_WEEK_PHRASES[dayOfWeek] ?? "Svake nedelje";
  return everyNWeeksLine(intervalWeeks, adverb);
}

/** "ponedeljkom i sredom" / "ponedeljkom, sredom i petkom". */
function joinDayAdverbs(weekdays: readonly number[]): string {
  const adverbs = weekdays.map((day) => DAY_ADVERBS[day] ?? "svakog dana");
  if (adverbs.length <= 1) return adverbs[0] ?? "";
  return `${adverbs.slice(0, -1).join(", ")} i ${adverbs[adverbs.length - 1]}`;
}

/** Sorted, deduped, 0-6 clamped - the column is a bare SMALLINT[]. */
function cleanWeekdays(raw: number[] | null | undefined): number[] {
  const clean = (raw ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return [...new Set(clean)].toSorted((a, b) => a - b);
}

/** Weekday sets a child has a single word for, as their sorted join. */
const EVERY_DAY_SET = "0,1,2,3,4,5,6";
const WORKDAY_SET = "0,1,2,3,4";
const WEEKEND_SET = "5,6";

type TaskRepeatFields = Pick<
  Task,
  "due_date" | "recurrence_period" | "recurrence_interval" | "recurrence_weekdays"
>;

/**
 * A chore's repeat rule in a child's words, or null when it does not repeat.
 *
 * Deliberately NOT `taskRecurrenceLabel` from utils/task.ts: that one is written
 * for a grown-up form ("Nedeljno", "Pon, Sre", "Svake 2 nedelje (Pon, Sre)")
 * and reads like a settings screen. A child gets the same weekday tables the
 * activity cards already use, so a chore and a piano lesson describe their weeks
 * the same way. The `recurrence_until` end date is dropped on purpose - "it
 * repeats until 31.12.2026" is a grown-up's concern.
 *
 *   Svaki dan / Svaki drugi dan / Na svaka 3 dana
 *   Svakog ponedeljka / Svake druge nedelje, ponedeljkom
 *   Ponedeljkom, sredom i petkom
 *   Radnim danima / Vikendom
 *   Jednom u mesecu / Na svaka 3 meseca
 */
export function taskRepeatLine(task: TaskRepeatFields): string | null {
  const period = task.recurrence_period;
  if (period == null || period === "one-time") return null;
  const interval = Math.max(1, Math.floor(task.recurrence_interval ?? 1));

  if (period === "daily") {
    if (interval === 1) return "Svaki dan";
    if (interval === 2) return "Svaki drugi dan";
    const span = pluralSr(
      interval,
      `svaki ${interval} dan`,
      `svaka ${interval} dana`,
      `svakih ${interval} dana`,
    );
    return `Na ${span}`;
  }

  if (period === "monthly") {
    if (interval === 1) return "Jednom u mesecu";
    const span = pluralSr(
      interval,
      `svaki ${interval} mesec`,
      `svaka ${interval} meseca`,
      `svakih ${interval} meseci`,
    );
    return `Na ${span}`;
  }

  // Weekly. An empty weekday set means "the day it started on", which is the one
  // place a weekday is derived from a date - hence `toMondayFirstDow`, so Sunday
  // is 6 and not JS's 0.
  const explicit = cleanWeekdays(task.recurrence_weekdays);
  const weekdays =
    explicit.length > 0
      ? explicit
      : task.due_date
        ? [toMondayFirstDow(parseDate(task.due_date).getDay())]
        : [];
  if (weekdays.length === 0) return interval === 1 ? "Svake nedelje" : null;
  if (weekdays.length === 1) return repeatLine(weekdays[0], interval);

  const asKey = weekdays.join(",");
  if (interval === 1) {
    if (asKey === EVERY_DAY_SET) return "Svaki dan";
    if (asKey === WORKDAY_SET) return "Radnim danima";
    if (asKey === WEEKEND_SET) return "Vikendom";
    return capitalize(joinDayAdverbs(weekdays));
  }
  return everyNWeeksLine(interval, joinDayAdverbs(weekdays));
}

function pushRow(
  rows: { icon: string; text: string }[],
  icon: string,
  text: string | null | undefined,
): void {
  const trimmed = text?.trim();
  if (trimmed) rows.push({ icon, text: trimmed });
}

/** "pon 12. - sre 14. oktobar" - the span line for a multi-day event. */
export function spanLine(fromISO: string, toISO: string): string {
  const from = `${weekdayName(fromISO).slice(0, 3)} ${formatKidShortDate(fromISO)}`;
  const to = `${weekdayName(toISO).slice(0, 3)} ${formatKidShortDate(toISO)}`;
  return `${from} - ${to}`;
}

/**
 * What a child is told when a grown-up called something off. Plain words, no
 * "otkazana aktivnost", no reasons a child cannot check.
 */
const CANCELED_TAG = "otkazano";
const CANCELED_ACTIVITY_LINE = "Otkazano - ovaj put ne ideš";
const CANCELED_EVENT_LINE = "Otkazano - neće biti";

/** A finished chore says so in words as well as in paint. */
const DONE_TAG = "urađeno";
const DONE_LINE = "Završeno!";
/** A repeat nobody resolved on its own day. Neutral: a fact, not a telling-off. */
const MISSED_TAG = "propušteno";

/**
 * "pomereno sa 18:00" - the line that stops a child thinking they misremembered
 * the time, and `null` when nothing actually moved.
 *
 * Everything it needs is already on the block: the resolver leaves the times the
 * rule WOULD have used on `override.originalStartTime`, and for a move to
 * another day the origin date on `override.movedFrom`. No lookup, no extra
 * query. Times go through `normalizeTime` because DB times carry seconds.
 */
function movedLine(block: ResolvedActivityBlock): string | null {
  const override = block.override;
  if (!override || override.action !== "reschedule") return null;
  const from = normalizeTime(override.originalStartTime);
  // Moved off another day: the day is the news, the old time only supports it.
  if (override.movedFrom && override.movedFrom !== block.date) {
    return `pomereno sa ${weekdayGenitive(override.movedFrom)}, ${from}`;
  }
  if (from === normalizeTime(block.startTime)) return null;
  return `pomereno sa ${from}`;
}

/**
 * Whether THIS child has ticked a chore off.
 *
 * The hook's per-child answer wins, because `item.isDone` speaks for the whole
 * occurrence and a chore in `completion_mode: 'per_assignee'` has as many
 * answers as it has assignees. Without a hook (a unit test, a screen with no
 * chores) the item's own answer stands in, which keeps this pure.
 */
function isKidTaskDone(
  item: Extract<AgendaItem, { kind: "task" }>,
  ctx: KidAgendaContext,
): boolean {
  return ctx.taskDone?.(item.task.id, item.occurrenceDate) ?? item.isDone;
}

/** Age turned on a given occurrence - year difference, no Date arithmetic. */
export function ageOnOccurrence(birthDate: string, occurrenceISO: string): number | null {
  const born = Number(birthDate.slice(0, 4));
  const year = Number(occurrenceISO.slice(0, 4));
  if (!Number.isFinite(born) || !Number.isFinite(year)) return null;
  const age = year - born;
  return age > 0 && age < 130 ? age : null;
}

// ---------------------------------------------------------------------------
// Card model
// ---------------------------------------------------------------------------

export function kidCardModel(item: AgendaItem, ctx: KidAgendaContext): KidCardModel {
  const emoji = emojiForAgendaItem(item);

  switch (item.kind) {
    case "activity": {
      const note = item.block.override?.note ?? null;
      return {
        emoji,
        title: item.activity?.name ?? "Aktivnost",
        // A parent's note on the override is usually the WHY ("trener bolestan")
        // - exactly what a child wants to read on a cancelled row.
        meta: note ?? item.activity?.description ?? item.activity?.notes ?? null,
        moved: item.canceled ? null : movedLine(item.block),
        time: item.block.startTime,
        timeMeta: item.block.endTime ? `do ${item.block.endTime}` : null,
        // The chip carries one message, and "otkazano" outranks "aktivnost".
        tag: item.canceled
          ? { tone: "canceled", label: CANCELED_TAG }
          : { tone: "activity", label: "aktivnost" },
        canceled: item.canceled,
        done: false,
      };
    }

    case "task": {
      const done = isKidTaskDone(item, ctx);
      return {
        emoji,
        title: item.task.name,
        // The repeat is what makes a chore a chore ("svaki dan" is the news, not
        // the name), so it outranks a parent's note as the one line under it.
        meta: taskRepeatLine(item.task) ?? item.task.description ?? null,
        moved: null,
        time: item.dueTime,
        timeMeta: null,
        tag: done
          ? { tone: "done", label: DONE_TAG }
          : item.missed
            ? { tone: "canceled", label: MISSED_TAG }
            : { tone: "task", label: "zadatak" },
        canceled: false,
        done,
      };
    }

    case "event": {
      const multiDay = item.totalDays > 1;
      const meta = multiDay
        ? spanLine(item.event.date, item.event.end_date ?? item.event.date)
        : (item.event.description ?? item.event.notes ?? null);
      return {
        emoji,
        title: item.event.name,
        meta,
        moved: null,
        time: item.startTime,
        timeMeta: item.startTime && item.endTime ? `do ${item.endTime}` : null,
        tag: item.canceled
          ? { tone: "canceled", label: CANCELED_TAG }
          : multiDay
            ? { tone: "span", label: `${item.totalDays} dana` }
            : { tone: "event", label: "događaj" },
        canceled: item.canceled,
        done: false,
      };
    }

    case "birthday": {
      const days = daysBetween(ctx.todayISO, item.date);
      const age = ageOnOccurrence(item.birthday.birth_date, item.date);
      return {
        emoji,
        title: age ? `${item.birthday.name} puni ${age}` : item.birthday.name,
        meta: `${weekdayName(item.date)}, ${formatKidShortDate(item.date)}`,
        moved: null,
        time: null,
        timeMeta: null,
        tag: { tone: "birthday", label: countdownLabel(days) },
        canceled: false,
        done: false,
      };
    }

    default:
      // Payments and mirrored Google events are filtered out before they get
      // here (and RLS never sends them to a kid at all). Total by construction.
      return {
        emoji,
        title: "Podsetnik",
        meta: null,
        moved: null,
        time: null,
        timeMeta: null,
        tag: null,
        canceled: false,
        done: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Detail model
// ---------------------------------------------------------------------------

export function kidDetailModel(item: AgendaItem, ctx: KidAgendaContext): KidDetailModel {
  const emoji = emojiForAgendaItem(item);
  const rows: { icon: string; text: string }[] = [];

  switch (item.kind) {
    case "activity": {
      const when = whenPrefix(item.date, ctx.todayISO);
      const end = item.block.endTime ? ` - ${item.block.endTime}` : "";
      // The news first, then the slot it would have taken. "Bilo je u planu:"
      // reads as a plan that fell through AND dodges Serbian case agreement -
      // after a colon every `whenPrefix` form fits, from "danas" to a full date.
      if (item.canceled) {
        rows.push({ icon: "❌", text: CANCELED_ACTIVITY_LINE });
        rows.push({
          icon: "🕐",
          text: `Bilo je u planu: ${when.toLowerCase()} u ${item.block.startTime}${end}`,
        });
      } else {
        rows.push({ icon: "🕐", text: `${when} u ${item.block.startTime}${end}` });
        pushRow(rows, "↪️", capitalizeOrNull(movedLine(item.block)));
      }
      pushRow(rows, "📝", item.activity?.description);
      pushRow(rows, "🎒", item.activity?.notes);
      pushRow(rows, "⚠️", item.block.override?.note);
      // The series survives a single cancellation, and saying so is the whole
      // reassurance: this one is off, the next one is not.
      rows.push({
        icon: "🔁",
        text: repeatLine(item.block.dayOfWeek, item.block.recurrenceIntervalWeeks),
      });
      return { emoji, title: item.activity?.name ?? "Aktivnost", rows };
    }

    case "task": {
      const done = isKidTaskDone(item, ctx);
      const when = whenPrefix(item.date, ctx.todayISO);
      // The news first, the same order a cancelled activity takes.
      if (done) rows.push({ icon: "✅", text: DONE_LINE });
      else if (item.missed) rows.push({ icon: "⌛", text: "Ovaj put nije završeno" });
      rows.push(
        item.dueTime
          ? { icon: "🕐", text: `${when} u ${item.dueTime}` }
          : // No clock on it: the day is the whole instruction, so say when it
            // can be done instead of inventing a time.
            { icon: "📅", text: done ? when : `${when}, kad stigneš` },
      );
      pushRow(rows, "🔁", taskRepeatLine(item.task));
      pushRow(rows, "📝", item.task.description);
      const days = daysBetween(ctx.todayISO, item.date);
      // Nothing left to count down to once it is done.
      if (days >= 2 && !done) rows.push({ icon: "⏳", text: capitalize(countdownLabel(days)) });
      return { emoji, title: item.task.name, rows };
    }

    case "event": {
      if (item.canceled) rows.push({ icon: "❌", text: CANCELED_EVENT_LINE });
      if (item.totalDays > 1) {
        rows.push({
          icon: "📅",
          text: spanLine(item.event.date, item.event.end_date ?? item.event.date),
        });
        rows.push({ icon: "⛰️", text: `Traje ${item.totalDays} dana` });
      }
      const when = whenPrefix(item.date, ctx.todayISO);
      if (item.startTime) {
        const end = item.endTime ? ` - ${item.endTime}` : "";
        const prefix = item.canceled ? `Bilo je u planu: ${when.toLowerCase()}` : when;
        rows.push({ icon: "🕐", text: `${prefix} u ${item.startTime}${end}` });
      } else if (item.totalDays === 1) {
        const prefix = item.canceled ? `Bilo je u planu: ${when.toLowerCase()}` : when;
        rows.push({ icon: "📅", text: `${prefix}, ceo dan` });
      }
      pushRow(rows, "📝", item.event.description);
      pushRow(rows, "🎒", item.event.notes);
      const days = daysBetween(ctx.todayISO, item.date);
      // No countdown to something that is not happening.
      if (days >= 2 && !item.canceled) {
        rows.push({ icon: "⏳", text: capitalize(countdownLabel(days)) });
      }
      return { emoji, title: item.event.name, rows };
    }

    case "birthday": {
      const days = daysBetween(ctx.todayISO, item.date);
      const age = ageOnOccurrence(item.birthday.birth_date, item.date);
      rows.push({ icon: "📅", text: capitalize(formatKidLongDate(item.date)) });
      if (age) rows.push({ icon: "🎂", text: `Puni ${age} godina` });
      rows.push({ icon: "⏳", text: capitalize(countdownLabel(days)) });
      pushRow(rows, "📝", item.birthday.description);
      return { emoji, title: item.birthday.name, rows };
    }

    default:
      return { emoji, title: "Podsetnik", rows };
  }
}
