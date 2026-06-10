// supabase/functions/_shared/expandEvent.ts
//
// Pure date/time expansion for the gcal sync — deliberately free of any Supabase
// (or other network) imports so it stays unit-testable in plain Node/Vitest.
//
// We have no multi-day event model locally: the agenda buckets everything by a
// single `local_date`. So a Google event that spans several calendar days is
// expanded here into one `When` per day, and the sync writes one row per day.

/** One day's worth of an event, as the sync stores it on a row. */
export interface When {
  startAt: string | null;
  endAt: string | null;
  localDate: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
}

/** Just the start/end shape we read off a Google event (plus id for logging). */
export interface EventWhenInput {
  id?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

/** Safety cap: an event longer than this is clamped to this many day-rows from
 *  its start (and a warning logged) so a stray year-long all-day marker can't
 *  fan out into hundreds of rows. */
export const MAX_SPAN_DAYS = 60;

/** `yyyy-mm-dd` plus n days, computed in UTC so DST never shifts the day. */
export function addIsoDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Formats an instant into the family timezone's wall-clock date + HH:MM. */
export function partsInTz(date: Date, tz: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour; // some runtimes emit 24 at midnight
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

/** An all-day day-row for `localDate`. */
function allDay(localDate: string): When {
  return {
    startAt: null,
    endAt: null,
    localDate,
    startTime: null,
    endTime: null,
    isAllDay: true,
  };
}

/**
 * One `When` per day the event occupies. Returns `[]` for an event with no
 * usable start (shouldn't happen with singleEvents=true).
 *
 *   • All-day (`start.date`/`end.date`): Google's `end.date` is EXCLUSIVE — an
 *     11–14 Jun event is start=11, end=15. One all-day row for each of 11..14.
 *   • Timed, single calendar day: one timed row (unchanged from before).
 *   • Timed, multiple calendar days: day 1 keeps its start time (open-ended),
 *     the following days become all-day continuation rows. An end at exactly
 *     local 00:00 is exclusive (doesn't occupy that day), matching all-day.
 */
export function expandWhen(ev: EventWhenInput, tz: string): When[] {
  // ── All-day ──────────────────────────────────────────────────────────────
  if (ev.start?.date) {
    const start = ev.start.date;
    const endExclusive = ev.end?.date && ev.end.date > start ? ev.end.date : addIsoDays(start, 1);
    const out: When[] = [];
    for (let d = start; d < endExclusive && out.length < MAX_SPAN_DAYS; d = addIsoDays(d, 1)) {
      out.push(allDay(d));
    }
    if (addIsoDays(start, MAX_SPAN_DAYS) < endExclusive) {
      console.warn(`gcal: all-day event ${ev.id ?? "?"} spans >${MAX_SPAN_DAYS}d — clamped`);
    }
    return out;
  }

  if (!ev.start?.dateTime) return [];

  // ── Timed ────────────────────────────────────────────────────────────────
  const startAt = new Date(ev.start.dateTime);
  const startParts = partsInTz(startAt, tz);

  // No end → single open-ended timed row (preserves prior behavior).
  if (!ev.end?.dateTime) {
    return [
      {
        startAt: startAt.toISOString(),
        endAt: null,
        localDate: startParts.date,
        startTime: startParts.time,
        endTime: null,
        isAllDay: false,
      },
    ];
  }

  const endAt = new Date(ev.end.dateTime);
  const endParts = partsInTz(endAt, tz);
  // An end at exactly local midnight ends the previous day (exclusive), so it
  // doesn't occupy `endParts.date`.
  const lastDate = endParts.time === "00:00" ? addIsoDays(endParts.date, -1) : endParts.date;

  // Single calendar day (the common case) — or a malformed end before start.
  if (lastDate <= startParts.date) {
    return [
      {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        localDate: startParts.date,
        startTime: startParts.time,
        endTime: endParts.time,
        isAllDay: false,
      },
    ];
  }

  // Multi-day timed: day 1 timed + open-ended, the rest all-day continuations.
  const out: When[] = [
    {
      startAt: startAt.toISOString(),
      endAt: null,
      localDate: startParts.date,
      startTime: startParts.time,
      endTime: null,
      isAllDay: false,
    },
  ];
  for (
    let d = addIsoDays(startParts.date, 1);
    d <= lastDate && out.length < MAX_SPAN_DAYS;
    d = addIsoDays(d, 1)
  ) {
    out.push(allDay(d));
  }
  if (addIsoDays(startParts.date, MAX_SPAN_DAYS - 1) < lastDate) {
    console.warn(`gcal: timed event ${ev.id ?? "?"} spans >${MAX_SPAN_DAYS}d — clamped`);
  }
  return out;
}
