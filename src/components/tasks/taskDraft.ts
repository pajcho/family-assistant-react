import { format, parseISO } from "date-fns";

import type { CreateTaskInput } from "@/hooks/useTasks";
import type { ReminderOption } from "@/components/ui/reminder-select";
import type { TaskRecurrencePeriod } from "@/types/database";
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
  assigneeIds: string[];
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
    assigneeIds: [],
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
 * The draft as a create payload. Everything the draft says "off" travels as
 * null, so the DB defaults and CHECK constraints all hold:
 *   - no date means no time and no recurrence to anchor;
 *   - a reminder only survives in the unit its task can actually fire in.
 */
export function taskDraftToCreateInput(draft: TaskDraft, listId: string | null): CreateTaskInput {
  const dueDate = draft.dueDate;
  const dueTime = dueDate ? draft.dueTime : null;
  const recurring = Boolean(dueDate) && draft.recurrencePeriod !== "one-time";
  return {
    name: draft.name.trim(),
    list_id: listId,
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
  return taskRecurrenceLabel({
    recurrence_period: draft.recurrencePeriod,
    recurrence_interval: draft.recurrenceInterval,
    recurrence_weekdays: draft.recurrenceWeekdays.length > 0 ? draft.recurrenceWeekdays : null,
    recurrence_until: draft.recurrenceUntil,
  });
}

export function taskReminderSummary(draft: TaskDraft): string | null {
  if (!draft.dueDate) return null;
  const options = draft.dueTime ? TASK_TIME_REMINDER_OPTIONS : TASK_DAY_REMINDER_OPTIONS;
  const value = draft.dueTime ? draft.remindMinutesBefore : draft.remindDaysBefore;
  if (value == null) return null;
  return options.find((option) => option.value === value)?.label ?? null;
}
