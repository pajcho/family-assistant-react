import type { Task, TaskOccurrence } from "@/types/database";

/**
 * "Završeno": everything that was ticked, keyed by the day it was ticked.
 *
 * Completion lives in two places, because 015 split it on recurrence: a one-off
 * carries `is_completed` + `completed_at` on the task row itself, while every
 * occurrence of a repeating chore gets its own `task_occurrences` row. Both are
 * "somebody finished something on a day", so this folds them into one shape and
 * every screen above it stops caring which kind it is looking at.
 *
 * Grouped by the day of the TICK, not the day it was due - that is the whole
 * difference from every other /tasks view, and it is what makes the screen
 * answer "what did we get done this week" instead of "what is coming".
 *
 * Pure, and free of any import chain reaching `lib/supabase` - CI has no
 * Supabase env.
 */

export interface CompletedEntry {
  /** Stable React key: a task appears once per occurrence it closed. */
  key: string;
  task: Task;
  /** Local calendar day of the tick, `YYYY-MM-DD`. */
  doneOn: string;
  /** Full timestamp of the tick, for ordering inside a day. Null on older rows. */
  doneAt: string | null;
  /** The occurrence this closed; null for a one-off. */
  occurrenceDate: string | null;
  /** Who ticked it, or null when nobody was recorded (older rows, shared ticks). */
  byPersonId: string | null;
  /**
   * Days between the deadline and the tick: 0 is on time, 3 is three days late,
   * null means it had no deadline to miss. Negative (finished early) is clamped
   * to 0 - "done two days ahead" is not what this column is for.
   */
  daysLate: number | null;
}

/** The LOCAL calendar day of a timestamp, which is the day a person remembers. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
function daysApart(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00`);
  const b = Date.parse(`${to}T12:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function lateness(due: string | null, doneOn: string): number | null {
  if (!due) return null;
  return Math.max(0, daysApart(due, doneOn));
}

/**
 * Everything ticked on or after `since` (a `YYYY-MM-DD` bound), newest first.
 *
 * A repeating task contributes one entry per done occurrence, so a daily chore
 * ticked all week reads as five lines on five days rather than one line that
 * says nothing about which days it actually happened.
 */
export function completedEntries(
  tasks: readonly Task[],
  occurrences: readonly TaskOccurrence[],
  since: string,
): CompletedEntry[] {
  const out: CompletedEntry[] = [];

  for (const task of tasks) {
    // A repeating task's own `is_completed` is never the truth (a CHECK
    // constraint keeps it false); its occurrences below are.
    if (!task.is_completed || !task.completed_at) continue;
    const doneOn = localDay(task.completed_at);
    if (doneOn < since) continue;
    out.push({
      key: task.id,
      task,
      doneOn,
      doneAt: task.completed_at,
      occurrenceDate: null,
      byPersonId: task.completed_by_person_id,
      daysLate: lateness(task.due_date, doneOn),
    });
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const row of occurrences) {
    if (row.status !== "done") continue;
    const task = byId.get(row.task_id);
    if (!task) continue;
    // `completed_at` is what the tick wrote; the occurrence's own date is the
    // fallback for a row that predates it being recorded.
    const doneOn = row.completed_at ? localDay(row.completed_at) : row.occurrence_date;
    if (doneOn < since) continue;
    out.push({
      key: `${row.task_id}:${row.occurrence_date}:${row.person_id ?? "all"}`,
      task,
      doneOn,
      doneAt: row.completed_at,
      occurrenceDate: row.occurrence_date,
      byPersonId: row.completed_by_person_id ?? row.person_id,
      // A moved occurrence is due where it was moved to, not where the series
      // projected it, so that is what it can be late against.
      daysLate: lateness(row.moved_to_date ?? row.occurrence_date, doneOn),
    });
  }

  out.sort((a, b) => {
    if (a.doneOn !== b.doneOn) return b.doneOn.localeCompare(a.doneOn);
    // Within a day, the most recent tick leads. A row with no timestamp sinks
    // to the bottom of its day rather than jumping the queue.
    return (b.doneAt ?? "").localeCompare(a.doneAt ?? "");
  });
  return out;
}

/** The entries as day buckets, newest day first - what the screen renders. */
export function groupCompletedByDay(
  entries: readonly CompletedEntry[],
): Array<{ day: string; items: CompletedEntry[] }> {
  const byDay = new Map<string, CompletedEntry[]>();
  for (const entry of entries) {
    const bucket = byDay.get(entry.doneOn);
    if (bucket) bucket.push(entry);
    else byDay.set(entry.doneOn, [entry]);
  }
  // `completedEntries` already sorted, so insertion order is newest-first.
  return [...byDay.entries()].map(([day, items]) => ({ day, items }));
}

/** "kasnio 3 dana" / "na vreme" / null when it never had a deadline. */
export function latenessLabel(daysLate: number | null): string | null {
  if (daysLate === null) return null;
  if (daysLate === 0) return "na vreme";
  if (daysLate === 1) return "kasnio 1 dan";
  return `kasnio ${daysLate} dana`;
}
