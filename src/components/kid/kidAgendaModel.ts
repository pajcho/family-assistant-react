import type { AgendaItem } from "@/hooks/useAgenda";
import type { AgendaKind } from "@/utils/agendaFilters";
import { filterAgendaItems } from "@/utils/agendaFilters";
import type { ResolvedActivityBlock } from "@/utils/activity";
import { normalizeTime } from "@/utils/activity";
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
}

export interface KidDetailModel {
  emoji: string;
  title: string;
  rows: { icon: string; text: string }[];
}

export interface KidAgendaContext {
  todayISO: string;
}

/**
 * The only agenda kinds a child ever sees. RLS already makes payments and
 * mirrored Google events invisible to a kid session, so this is belt and
 * braces - but it also keeps the shell honest if a future kind is added to the
 * agenda layer and nobody thinks about children that day.
 */
export const KID_AGENDA_KINDS: ReadonlySet<AgendaKind> = new Set<AgendaKind>([
  "activity",
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

export function repeatLine(dayOfWeek: number, intervalWeeks: number): string {
  const adverb = DAY_ADVERBS[dayOfWeek] ?? "svake nedelje";
  if (intervalWeeks <= 1) return EVERY_WEEK_PHRASES[dayOfWeek] ?? "Svake nedelje";
  if (intervalWeeks === 2) return `Svake druge nedelje, ${adverb}`;
  // 2-4 take the accusative ("svake 3 nedelje"), 5+ the genitive
  // ("svakih 5 nedelja") - the same one/few/many split as everywhere else.
  const span = pluralSr(
    intervalWeeks,
    `svake ${intervalWeeks} nedelje`,
    `svake ${intervalWeeks} nedelje`,
    `svakih ${intervalWeeks} nedelja`,
  );
  return `Na ${span}, ${adverb}`;
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
