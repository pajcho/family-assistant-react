import { describe, expect, it } from "vitest";

import {
  TASK_DAY_REMINDER_OPTIONS,
  TASK_TIME_REMINDER_OPTIONS,
  emptyTaskDraft,
  taskDateSummary,
  taskDraftToCreateInput,
  taskRecurrenceSummary,
  taskReminderSummary,
} from "@/components/tasks/taskDraft";

/**
 * The composer's draft -> insert payload contract. Everything here is about the
 * shapes the database refuses: a time without a date, a recurrence with nothing
 * to anchor on, a reminder in a unit its task cannot fire in.
 *
 * Imports the pure module on purpose - `TaskFields.tsx` reaches `lib/supabase`
 * through its pickers, and CI has no Supabase env.
 */

const TODAY = "2026-08-10";
const TOMORROW = "2026-08-11";

describe("taskDraftToCreateInput", () => {
  it("sends a bare name as a plain list item", () => {
    const input = taskDraftToCreateInput(emptyTaskDraft({ name: "  Mleko  " }), "list-1");
    expect(input.name).toBe("Mleko");
    expect(input.list_id).toBe("list-1");
    expect(input.due_date).toBeNull();
    expect(input.due_time).toBeNull();
    expect(input.recurrence_period).toBeNull();
    expect(input.remind_days_before).toBeNull();
    expect(input.remind_minutes_before).toBeNull();
  });

  it("keeps list_id null for a standalone task", () => {
    expect(taskDraftToCreateInput(emptyTaskDraft({ name: "Pozvati servis" }), null).list_id).toBe(
      null,
    );
  });

  it("drops the time and every recurrence field when there is no date", () => {
    const input = taskDraftToCreateInput(
      emptyTaskDraft({
        name: "Izneti smeće",
        dueTime: "18:30",
        recurrencePeriod: "daily",
        recurrenceInterval: 3,
        recurrenceUntil: "2026-12-31",
        remindDaysBefore: 1,
        remindMinutesBefore: 30,
      }),
      null,
    );
    expect(input.due_time).toBeNull();
    expect(input.recurrence_period).toBeNull();
    expect(input.recurrence_interval).toBe(1);
    expect(input.recurrence_until).toBeNull();
    expect(input.remind_days_before).toBeNull();
    expect(input.remind_minutes_before).toBeNull();
  });

  it("routes an all-day reminder to days and a timed one to minutes", () => {
    const allDay = taskDraftToCreateInput(
      emptyTaskDraft({ name: "Rok", dueDate: TODAY, remindDaysBefore: 3, remindMinutesBefore: 30 }),
      null,
    );
    expect(allDay.remind_days_before).toBe(3);
    expect(allDay.remind_minutes_before).toBeNull();

    const timed = taskDraftToCreateInput(
      emptyTaskDraft({
        name: "Rok",
        dueDate: TODAY,
        dueTime: "09:00",
        remindDaysBefore: 3,
        remindMinutesBefore: 30,
      }),
      null,
    );
    expect(timed.remind_minutes_before).toBe(30);
    expect(timed.remind_days_before).toBeNull();
  });

  it("sorts the weekday set and only sends it for a weekly rule", () => {
    const weekly = taskDraftToCreateInput(
      emptyTaskDraft({
        name: "Trening",
        dueDate: TODAY,
        recurrencePeriod: "weekly",
        recurrenceWeekdays: [4, 0, 2],
      }),
      null,
    );
    expect(weekly.recurrence_weekdays).toEqual([0, 2, 4]);

    const monthly = taskDraftToCreateInput(
      emptyTaskDraft({
        name: "Filter",
        dueDate: TODAY,
        recurrencePeriod: "monthly",
        recurrenceWeekdays: [4, 0, 2],
      }),
      null,
    );
    expect(monthly.recurrence_weekdays).toBeNull();
  });

  it("sends no weekday set when the weekly rule has none", () => {
    const weekly = taskDraftToCreateInput(
      emptyTaskDraft({ name: "Trening", dueDate: TODAY, recurrencePeriod: "weekly" }),
      null,
    );
    expect(weekly.recurrence_weekdays).toBeNull();
  });
});

describe("reminder presets", () => {
  // `TASK_WINDOW_DAYS_AFTER = 14` in send-due-pushes/plan.ts is how far ahead the
  // digest looks, so an offset beyond it would sit in the row and never fire.
  it("never offers an all-day offset the digest cannot reach", () => {
    for (const option of TASK_DAY_REMINDER_OPTIONS) {
      if (option.value === null) continue;
      expect(option.value).toBeLessThanOrEqual(14);
      expect(option.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps timed offsets inside a day", () => {
    for (const option of TASK_TIME_REMINDER_OPTIONS) {
      if (option.value === null) continue;
      expect(option.value).toBeLessThanOrEqual(24 * 60);
    }
  });
});

describe("summaries", () => {
  it("names today and tomorrow instead of printing their dates", () => {
    expect(taskDateSummary(emptyTaskDraft({ dueDate: TODAY }), TODAY, TOMORROW)).toBe("Danas");
    expect(taskDateSummary(emptyTaskDraft({ dueDate: TOMORROW }), TODAY, TOMORROW)).toBe("Sutra");
    expect(taskDateSummary(emptyTaskDraft({ dueDate: "2026-09-04" }), TODAY, TOMORROW)).toContain(
      "4.",
    );
  });

  it("appends the time when one is set", () => {
    expect(
      taskDateSummary(emptyTaskDraft({ dueDate: TODAY, dueTime: "09:00" }), TODAY, TOMORROW),
    ).toBe("Danas, 09:00");
  });

  it("has nothing to say about an undated draft", () => {
    const draft = emptyTaskDraft({ recurrencePeriod: "daily", remindDaysBefore: 1 });
    expect(taskDateSummary(draft, TODAY, TOMORROW)).toBeNull();
    expect(taskRecurrenceSummary(draft)).toBeNull();
    expect(taskReminderSummary(draft)).toBeNull();
  });

  it("reads the recurrence rule back in words", () => {
    expect(
      taskRecurrenceSummary(emptyTaskDraft({ dueDate: TODAY, recurrencePeriod: "daily" })),
    ).toBe("Svaki dan");
    expect(
      taskRecurrenceSummary(
        emptyTaskDraft({
          dueDate: TODAY,
          recurrencePeriod: "weekly",
          recurrenceWeekdays: [0, 1, 2, 3, 4],
        }),
      ),
    ).toBe("Radnim danima");
  });

  it("reads the reminder back from the ladder its unit belongs to", () => {
    expect(taskReminderSummary(emptyTaskDraft({ dueDate: TODAY, remindDaysBefore: 1 }))).toBe(
      "Dan pre",
    );
    expect(
      taskReminderSummary(
        emptyTaskDraft({ dueDate: TODAY, dueTime: "09:00", remindMinutesBefore: 60 }),
      ),
    ).toBe("Sat ranije");
  });
});
