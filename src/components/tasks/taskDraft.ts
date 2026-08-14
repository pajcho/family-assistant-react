import { format, parseISO } from "date-fns";

import type { CreateTaskInput, UpdateTaskInput } from "@/hooks/useTasks";
import type { ReminderOption } from "@/components/ui/reminder-select";
import type { Task, TaskCompletionMode, TaskRecurrencePeriod, TaskScope } from "@/types/database";
import { srLocale } from "@/utils/date";
import { taskRecurrenceLabel } from "@/utils/task";

/**
 * The optional dimensions of a new task, as data: the draft shape, the option
 * ladders and the read-back strings the composer's chips and the quick-add form
 * print.
 *
 * Pure, and it MUST stay free of any import chain that reaches `lib/supabase` -
 * CI has no Supabase env, so that chain is what breaks the tests there. The
 * editors that render these live in `TaskFields.tsx`.
 *
 * Every field is optional and every default is "off": `name` alone is a plain
 * list item, which is the shape a shopping list needs to stay one tap away.
 */

export type TaskDraft = {
  name: string;
  dueDate: string | null;
  /** `HH:mm`. Requires `dueDate` - a CHECK constraint says so. */
  dueTime: string | null;
  /**
   * "Samo ja" - the task is `scope = 'personal'`, so RLS shows it to its owner
   * alone. Only a LISTLESS task answers for its own visibility; one inside a
   * list carries its list's, forced by a trigger, which is why every editor
   * disables the switch as soon as a list is picked.
   *
   * Invariant the editors maintain: while this is true, `assigneeIds` is
   * exactly the viewer. Assigning anybody else, or dropping yourself, is the
   * other way out of private.
   */
  onlyMe: boolean;
  assigneeIds: string[];
  /**
   * Who a tick speaks for on a REPEATING task: `shared` closes the occurrence
   * for everybody, `per_assignee` gives each assignee their own copy to tick.
   *
   * Only ever visible - and only ever sent as anything but `shared` - when the
   * task repeats AND has two or more people on it, which is the only situation
   * where the two differ at all. See `taskDraftColumns`.
   */
  completionMode: TaskCompletionMode;
  recurrencePeriod: TaskRecurrencePeriod;
  recurrenceInterval: number;
  /** 0 = Monday .. 6 = Sunday. Never a raw JS `getDay()`. */
  recurrenceWeekdays: number[];
  recurrenceUntil: string | null;
  remindMinutesBefore: number | null;
  remindDaysBefore: number | null;
};

export function emptyTaskDraft(overrides?: Partial<TaskDraft>): TaskDraft {
  return {
    name: "",
    dueDate: null,
    dueTime: null,
    onlyMe: false,
    assigneeIds: [],
    completionMode: "shared",
    recurrencePeriod: "one-time",
    recurrenceInterval: 1,
    recurrenceWeekdays: [],
    recurrenceUntil: null,
    remindMinutesBefore: null,
    remindDaysBefore: null,
    ...overrides,
  };
}

/**
 * What a task being created OUTSIDE any list starts as: private to whoever is
 * typing it, and assigned to them.
 *
 * A task in a list inherits a visibility somebody chose deliberately when they
 * made the list. A listless one has no such answer, and defaulting it to the
 * whole family means every private note is a broadcast until its author notices
 * the switch. So the default fails CLOSED - `onlyMe` holds even when the
 * viewer's profile id has not loaded yet, because `owner_id` is stamped from
 * `auth.uid()` server-side and the row is still correctly yours without it.
 */
export function privateDraftDefaults(viewerId: string | null): Partial<TaskDraft> {
  return { onlyMe: true, assigneeIds: viewerId ? [viewerId] : [] };
}

/** A saved task back as a draft - what the editor opens on. */
export function taskToDraft(task: Task, assigneeIds: string[]): TaskDraft {
  return {
    name: task.name,
    dueDate: task.due_date,
    // Postgres hands back "HH:MM:SS"; the pickers speak "HH:MM".
    dueTime: task.due_time ? task.due_time.slice(0, 5) : null,
    // A listed task's `scope` mirrors its list's (the trigger keeps them equal),
    // so it says nothing about a per-task choice - only a listless one does.
    onlyMe: task.list_id === null && task.scope === "personal",
    assigneeIds,
    completionMode: task.completion_mode,
    recurrencePeriod: task.recurrence_period ?? "one-time",
    recurrenceInterval: task.recurrence_interval,
    recurrenceWeekdays: task.recurrence_weekdays ?? [],
    recurrenceUntil: task.recurrence_until,
    remindMinutesBefore: task.remind_minutes_before,
    remindDaysBefore: task.remind_days_before,
  };
}

/**
 * The scheduling columns a draft resolves to. Everything the draft says "off"
 * travels as null, so the DB defaults and CHECK constraints all hold:
 *   - no date means no time and no recurrence to anchor;
 *   - a reminder only survives in the unit its task can actually fire in.
 *
 * Shared by create and update so that clearing a date on an EXISTING task tears
 * down its recurrence and reminder exactly as never setting one would - a
 * half-cleared row is how a chore ends up repeating off a date it no longer has.
 */
function taskDraftColumns(draft: TaskDraft) {
  const dueDate = draft.dueDate;
  const dueTime = dueDate ? draft.dueTime : null;
  const recurring = Boolean(dueDate) && draft.recurrencePeriod !== "one-time";
  return {
    // Per-assignee completion only means anything for a repeating task with
    // more than one person on it: a one-off is answered by `is_completed`, and
    // a single assignee's own copy IS the whole occurrence. Anything else
    // travels as `shared`, so a task that loses its repeat or its second person
    // cannot keep a mode that no longer applies to it.
    completion_mode: recurring && draft.assigneeIds.length > 1 ? draft.completionMode : "shared",
    name: draft.name.trim(),
    due_date: dueDate,
    due_time: dueTime,
    recurrence_period: recurring ? draft.recurrencePeriod : null,
    recurrence_interval: recurring ? draft.recurrenceInterval : 1,
    recurrence_weekdays:
      recurring && draft.recurrencePeriod === "weekly" && draft.recurrenceWeekdays.length > 0
        ? [...draft.recurrenceWeekdays].sort((a, b) => a - b)
        : null,
    recurrence_until: recurring ? draft.recurrenceUntil : null,
    remind_minutes_before: dueTime ? draft.remindMinutesBefore : null,
    remind_days_before: dueDate && !dueTime ? draft.remindDaysBefore : null,
    assigneeIds: draft.assigneeIds,
  };
}

/**
 * `scope`, but only when the task is listless.
 *
 * A task inside a list has its scope FORCED to the list's by
 * `set_task_defaults()` / `enforce_task_defaults()`, so sending one is at best
 * ignored - and at worst it is the value the optimistic cache patch shows for a
 * beat before the round-trip corrects it. Omitting it keeps the client honest.
 */
function scopeColumn(draft: TaskDraft, listId: string | null) {
  return listId === null ? { scope: draft.onlyMe ? "personal" : ("family" as TaskScope) } : {};
}

export function taskDraftToCreateInput(draft: TaskDraft, listId: string | null): CreateTaskInput {
  return { ...taskDraftColumns(draft), list_id: listId, ...scopeColumn(draft, listId) };
}

/**
 * The draft as an update payload, plus the one field the draft does not carry.
 * `listId` is the task's CURRENT list - this form cannot move a task between
 * lists, it only needs to know whether `scope` is the row's own business.
 */
export function taskDraftToUpdateInput(
  draft: TaskDraft,
  description: string | null,
  listId: string | null,
): UpdateTaskInput {
  return { ...taskDraftColumns(draft), description, ...scopeColumn(draft, listId) };
}

/* ------------------------------------------------------------------------- */
/* Option lists                                                               */
/* ------------------------------------------------------------------------- */

export const TASK_RECURRENCE_OPTIONS: ReadonlyArray<{
  value: TaskRecurrencePeriod;
  label: string;
}> = [
  { value: "one-time", label: "Bez ponavljanja" },
  { value: "daily", label: "Svaki dan" },
  { value: "weekly", label: "Nedeljno" },
  { value: "monthly", label: "Mesečno" },
];

export const DAILY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "svaki dan" },
  { value: 2, label: "svaki drugi dan" },
  { value: 3, label: "svaka 3 dana" },
];

export const WEEKLY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "svake nedelje" },
  { value: 2, label: "svake 2 nedelje" },
  { value: 4, label: "svake 4 nedelje" },
];

export const MONTHLY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "svakog meseca" },
  { value: 2, label: "svaka 2 meseca" },
  { value: 3, label: "svaka 3 meseca" },
  { value: 6, label: "svakih 6 meseci" },
];

/**
 * All-day reminders, in days. Capped at 14 on purpose: the digest's
 * `TASK_WINDOW_DAYS_AFTER = 14` is how far ahead `send-due-pushes` looks, so an
 * offset beyond it would sit in the row and never fire. Raising this means
 * raising that constant in the same release.
 */
export const TASK_DAY_REMINDER_OPTIONS: ReadonlyArray<ReminderOption> = [
  { value: null, label: "Bez podsetnika" },
  { value: 0, label: "Na dan roka" },
  { value: 1, label: "Dan pre" },
  { value: 3, label: "3 dana pre" },
  { value: 7, label: "Nedelju dana pre" },
  { value: 14, label: "Dve nedelje pre" },
];

/** Timed reminders, in minutes - the same ladder events use. */
export const TASK_TIME_REMINDER_OPTIONS: ReadonlyArray<ReminderOption> = [
  { value: null, label: "Bez podsetnika" },
  { value: 0, label: "U trenutku roka" },
  { value: 15, label: "15 minuta ranije" },
  { value: 30, label: "30 minuta ranije" },
  { value: 60, label: "Sat ranije" },
  { value: 120, label: "2 sata ranije" },
];

/* ------------------------------------------------------------------------- */
/* Summaries - what the composer's chips and the form's rows read back        */
/* ------------------------------------------------------------------------- */

/** "Danas" / "Sutra" / "4. avg" / "4. avg, 18:00" - or null when undated. */
export function taskDateSummary(draft: TaskDraft, today: string, tomorrow: string): string | null {
  if (!draft.dueDate) return null;
  const day =
    draft.dueDate === today
      ? "Danas"
      : draft.dueDate === tomorrow
        ? "Sutra"
        : format(parseISO(`${draft.dueDate}T12:00:00`), "d. MMM", { locale: srLocale });
  return draft.dueTime ? `${day}, ${draft.dueTime}` : day;
}

export function taskRecurrenceSummary(draft: TaskDraft): string | null {
  if (!draft.dueDate || draft.recurrencePeriod === "one-time") return null;
  const label = taskRecurrenceLabel({
    recurrence_period: draft.recurrencePeriod,
    recurrence_interval: draft.recurrenceInterval,
    recurrence_weekdays: draft.recurrenceWeekdays.length > 0 ? draft.recurrenceWeekdays : null,
    recurrence_until: draft.recurrenceUntil,
  });
  // The mode rides on the recurrence chip, because that is the sheet it is set
  // in - and because a composer collapsed to its chips would otherwise say
  // nothing about a decision that changes who has to do the work.
  const perPerson = draft.completionMode === "per_assignee" && draft.assigneeIds.length > 1;
  return perPerson && label ? `${label} · svako svoje` : label;
}

export function taskReminderSummary(draft: TaskDraft): string | null {
  if (!draft.dueDate) return null;
  const options = draft.dueTime ? TASK_TIME_REMINDER_OPTIONS : TASK_DAY_REMINDER_OPTIONS;
  const value = draft.dueTime ? draft.remindMinutesBefore : draft.remindDaysBefore;
  if (value == null) return null;
  return options.find((option) => option.value === value)?.label ?? null;
}
