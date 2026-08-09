import { daysBetween, formatTime, parseDate } from "./date";
import { formatEventDateRange, formatEventTimeRange } from "./event";
import { serbianPlural } from "./plural";

/**
 * Ranks which activity / event / birthday a money entry most likely belongs to.
 *
 * The old rule was one substring match on the typed name, shown with no date -
 * enough to link a hairdresser payment to a three-month-old "Sonja frizer"
 * event by accident. This replaces it with several independent signals, each
 * carrying WHY it fired so the UI can print the evidence next to the name:
 *
 *   • time    - a fiscal receipt's clock time falls inside a termin / event
 *               window (± {@link TIME_GRACE_MINUTES}). The strongest signal
 *               there is: you were provably there when you paid.
 *   • ongoing - a multi-day event's span covers the entry's date. "Everything
 *               bought during the trip belongs to the trip."
 *   • sameDay - a single-day event, a birthday, or an activity termin on that
 *               exact date.
 *   • nearDay - an event within {@link NEAR_DAY_WINDOW} days. Deposits and
 *               instalments are paid before the thing happens, not during it.
 *   • name    - the substring match, kept but no longer alone.
 *
 * Scores ADD UP, so a candidate that matches the name AND the day outranks one
 * that only matches the day; the printed reason is the strongest single signal.
 * Everything here is pure - the caller resolves activity termini and passes
 * them in as {@link SuggestionCandidate.daySlots}.
 */

export type SuggestionKind = "activity" | "event" | "birthday";

export type CandidateSlot = {
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
};

export type SuggestionCandidate = {
  kind: SuggestionKind;
  id: string;
  name: string;
  /** Events: first day of the span. Birthdays: the next occurrence. */
  date?: string;
  /** Events: inclusive last day of a multi-day span. */
  endDate?: string | null;
  /** Events: span-edge times. */
  startTime?: string | null;
  endTime?: string | null;
  /**
   * Activities: the termini that actually fire on the context date, resolved
   * by the caller (overrides and A/B shifts need query data). Empty or absent
   * means the activity has nothing scheduled that day.
   */
  daySlots?: ReadonlyArray<CandidateSlot>;
  /** Activities: their weekly shape ("Pon, Sre · 17:00 - 18:00"). */
  scheduleLabel?: string | null;
};

export type SuggestionContext = {
  /** Free text the member typed - payment/expense name, or a merchant. */
  name?: string | null;
  /** The entry's own date (due_date / spent_on / receipt date), YYYY-MM-DD. */
  date?: string | null;
  /** Wall-clock "HH:MM" - only a scanned fiscal receipt knows this. */
  time?: string | null;
};

export type LinkSuggestionReason = "time" | "ongoing" | "sameDay" | "nearDay" | "name";

export type LinkSuggestion<C extends SuggestionCandidate = SuggestionCandidate> = {
  candidate: C;
  /** The strongest single signal - what the UI prints as the reason. */
  reason: LinkSuggestionReason;
  score: number;
  /** The termin/window the time signal hit, when it did. */
  matchedSlot?: CandidateSlot;
  /** Signed day distance for `nearDay` (positive = the entity is ahead). */
  dayDelta?: number;
};

/** A receipt's clock time rarely lands inside the termin - you pay on the way out. */
export const TIME_GRACE_MINUTES = 45;

/** How far ahead/back an event still counts as "around this date". */
export const NEAR_DAY_WINDOW = 7;

/** Shortest typed name that may drive a match ("Fri" must not light up). */
export const MIN_NAME_LENGTH = 3;

const SCORE: Record<LinkSuggestionReason, number> = {
  time: 100,
  ongoing: 70,
  sameDay: 60,
  name: 45,
  nearDay: 20,
};

function toMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

/** Inclusive last day of a candidate's span - its own date when single-day. */
function lastDay(candidate: SuggestionCandidate): string | null {
  if (!candidate.date) return null;
  return candidate.endDate && candidate.endDate > candidate.date
    ? candidate.endDate
    : candidate.date;
}

function isMultiDay(candidate: SuggestionCandidate): boolean {
  const end = lastDay(candidate);
  return !!end && !!candidate.date && end !== candidate.date;
}

/** Signed day distance from the context date to the candidate's nearest edge. */
function dayDistance(candidate: SuggestionCandidate, date: string): number | null {
  if (!candidate.date) return null;
  const end = lastDay(candidate) as string;
  if (candidate.date <= date && date <= end) return 0;
  const target = date < candidate.date ? candidate.date : end;
  return daysBetween(parseDate(date), parseDate(target));
}

/**
 * Does `minutes` fall inside a window, allowing {@link TIME_GRACE_MINUTES} of
 * slack on both sides? An open-ended window (only a start) matches forward
 * from the start for the grace period alone.
 */
function windowHit(minutes: number, start: number | null, end: number | null): boolean {
  if (start == null && end == null) return false;
  const from = (start ?? (end as number)) - TIME_GRACE_MINUTES;
  const to = (end ?? (start as number)) + TIME_GRACE_MINUTES;
  return minutes >= from && minutes <= to;
}

/** Substring match in EITHER direction - "Engl" ⊂ "Engleski" and vice versa. */
function nameHit(candidateName: string, typed: string): boolean {
  const a = candidateName.trim().toLowerCase();
  const b = typed.trim().toLowerCase();
  if (a.length === 0 || b.length < MIN_NAME_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Score every candidate against the context and return the ones that matched,
 * best first. `limit` caps the result; ties break on the closer date, then the
 * name, so the order never depends on the input array's order.
 */
export function rankLinkSuggestions<C extends SuggestionCandidate>(
  candidates: ReadonlyArray<C>,
  context: SuggestionContext,
  limit = 3,
): LinkSuggestion<C>[] {
  const typed = context.name?.trim() ?? "";
  const date = context.date?.trim() || null;
  const minutes = toMinutes(context.time);

  const scored: Array<LinkSuggestion<C> & { distance: number }> = [];

  for (const candidate of candidates) {
    let score = 0;
    let reason: LinkSuggestionReason | null = null;
    let matchedSlot: CandidateSlot | undefined;
    let dayDelta: number | undefined;

    // The strongest signal seen so far wins the printed reason; equal scores
    // keep the earlier (higher-priority) one, hence the strict >.
    const record = (next: LinkSuggestionReason) => {
      score += SCORE[next];
      if (reason == null || SCORE[next] > SCORE[reason]) reason = next;
    };

    const distance = date ? dayDistance(candidate, date) : null;
    // Activity termini are resolved FOR the context date, so they only count
    // as a date signal when there is one - without it they are just the
    // activity's weekly shape and must not stand in for "it happened then".
    const onDate =
      !!date &&
      (distance === 0 || (candidate.kind === "activity" && (candidate.daySlots?.length ?? 0) > 0));

    // --- time: only meaningful on the entry's own day ---
    if (minutes != null && onDate) {
      if (candidate.kind === "activity") {
        matchedSlot = (candidate.daySlots ?? []).find((slot) =>
          windowHit(minutes, toMinutes(slot.startTime), toMinutes(slot.endTime)),
        );
        if (matchedSlot) record("time");
      } else if (candidate.kind === "event") {
        // Span-edge times: on a middle day of a multi-day event there is no
        // window to miss - the event covers the whole day, so the date signal
        // already says everything and no time bonus applies.
        const start = toMinutes(candidate.startTime);
        const end = toMinutes(candidate.endTime);
        if (!isMultiDay(candidate) && windowHit(minutes, start, end)) {
          record("time");
          matchedSlot = {
            startTime: candidate.startTime ?? "",
            endTime: candidate.endTime ?? candidate.startTime ?? "",
          };
        }
      }
    }

    // --- date ---
    if (distance === 0) {
      record(isMultiDay(candidate) ? "ongoing" : "sameDay");
    } else if (candidate.kind === "activity" && onDate) {
      record("sameDay");
    } else if (
      distance != null &&
      candidate.kind !== "activity" &&
      Math.abs(distance) <= NEAR_DAY_WINDOW
    ) {
      record("nearDay");
      dayDelta = distance;
    }

    // --- name ---
    if (typed.length >= MIN_NAME_LENGTH && nameHit(candidate.name, typed)) record("name");

    if (reason == null) continue;
    scored.push({
      candidate,
      reason,
      score,
      matchedSlot,
      dayDelta,
      distance: distance == null ? Number.MAX_SAFE_INTEGER : Math.abs(distance),
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.distance - b.distance ||
      a.candidate.name.localeCompare(b.candidate.name, "sr"),
  );

  return scored.slice(0, limit).map(({ distance: _distance, ...suggestion }) => suggestion);
}

/** "za 3 dana" / "pre 2 dana" / "sutra" / "juče". */
function deltaLabel(delta: number): string {
  if (delta === 1) return "sutra";
  if (delta === -1) return "juče";
  const n = Math.abs(delta);
  const days = `${n} ${serbianPlural(n, { one: "dan", few: "dana", many: "dana" })}`;
  return delta > 0 ? `za ${days}` : `pre ${days}`;
}

/**
 * The one-line evidence printed under a suggestion: why it is here, then the
 * date or time that proves it. The date is never omitted - not knowing WHEN
 * the suggested thing happens is exactly how a May event gets linked to an
 * August payment.
 */
export function suggestionDetail(suggestion: LinkSuggestion): string {
  const { candidate, reason, matchedSlot, dayDelta } = suggestion;

  if (candidate.kind === "activity") {
    const slot = matchedSlot ?? candidate.daySlots?.[0];
    const time = slot ? `${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}` : null;
    if (reason === "time") return time ? `u to vreme · ${time}` : "u to vreme";
    if (reason === "sameDay") return time ? `termin tog dana · ${time}` : "termin tog dana";
    return time ? `termin · ${time}` : "aktivnost";
  }

  const span = candidate.date
    ? formatEventDateRange({ date: candidate.date, end_date: candidate.endDate ?? null })
    : null;

  if (candidate.kind === "birthday") {
    const base = span ?? "rođendan";
    return reason === "nearDay" && dayDelta != null ? `${deltaLabel(dayDelta)} · ${base}` : base;
  }

  const times = candidate.date
    ? formatEventTimeRange({
        date: candidate.date,
        end_date: candidate.endDate ?? null,
        start_time: candidate.startTime ?? null,
        end_time: candidate.endTime ?? null,
      })
    : null;

  switch (reason) {
    case "time":
      return times ? `u to vreme · ${times}` : `u to vreme${span ? ` · ${span}` : ""}`;
    case "ongoing":
      return span ? `u toku · ${span}` : "u toku";
    case "nearDay":
      return dayDelta != null && span ? `${deltaLabel(dayDelta)} · ${span}` : (span ?? "");
    default:
      // Name-only: no reason word to print, so show the plain facts - which is
      // the whole point, since a bare name is what hid the stale May event.
      return candidateDetail(candidate);
  }
}

/** Static "what is this" line for a picker row - no context, just the facts. */
export function candidateDetail(candidate: SuggestionCandidate): string {
  if (candidate.kind === "activity") return candidate.scheduleLabel || "Aktivnost";
  if (!candidate.date) return "";
  const span = formatEventDateRange({ date: candidate.date, end_date: candidate.endDate ?? null });
  if (candidate.kind === "birthday") return span;
  const times = formatEventTimeRange({
    date: candidate.date,
    end_date: candidate.endDate ?? null,
    start_time: candidate.startTime ?? null,
    end_time: candidate.endTime ?? null,
  });
  if (times === "Ceo dan") return span;
  // A multi-day time range already spells out both edge dates ("05.08. 06:00 -
  // 15.08. 20:00"), so prefixing the span again just truncates the row.
  return isMultiDay(candidate) ? times : `${span} · ${times}`;
}

/**
 * A scanned fiscal receipt as suggestion context: the shop name plus the exact
 * moment of purchase. The clock time is the signal no hand-typed entry can
 * offer - it pins the spend to whatever termin or event was running right
 * then. Absent on the stored fast path, where the DB keeps only `issued_on`
 * (a bare date), so the `T` guard is load-bearing.
 *
 * Takes a plain shape rather than `ParsedReceipt`: that type lives next to a
 * module chain reaching `lib/supabase`, which throws at import time wherever
 * the Supabase env is missing (CI).
 */
export function receiptSuggestContext(receipt: {
  merchant?: string | null;
  issuedAt: string;
}): SuggestionContext {
  const time = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(receipt.issuedAt)?.[1] ?? null;
  return { name: receipt.merchant ?? null, date: receipt.issuedAt.slice(0, 10), time };
}
