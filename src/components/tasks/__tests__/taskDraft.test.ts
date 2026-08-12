import { describe, expect, it } from "vitest";

import {
  TASK_DAY_REMINDER_OPTIONS,
  TASK_TIME_REMINDER_OPTIONS,
  emptyTaskDraft,
  privateDraftDefaults,
  taskDateSummary,
  taskDraftToCreateInput,
  taskDraftToUpdateInput,
  taskRecurrenceSummary,
  taskReminderSummary,
  taskToDraft,
} from "@/components/tasks/taskDraft";
import type { Task } from "@/types/database";

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

/**
 * "Samo ja". Only a LISTLESS task answers for its own visibility - one inside a
 * list carries its list's, forced by `set_task_defaults()` - so the whole
 * contract here is about which of the two the payload is allowed to speak for.
 */
describe("private tasks", () => {
  function task(overrides: Partial<Task> = {}): Task {
    return {
      id: "task-1",
      list_id: null,
      family_id: "fam-1",
      owner_id: "user-1",
      scope: "family",
      name: "Poklon za Anu",
      description: null,
      is_completed: false,
      completed_at: null,
      completed_by_person_id: null,
      due_date: null,
      due_time: null,
      recurrence_period: null,
      recurrence_interval: 1,
      recurrence_weekdays: null,
      recurrence_until: null,
      completion_mode: "shared",
      remind_minutes_before: null,
      remind_days_before: null,
      sort_order: 1,
      created_by_id: "user-1",
      updated_by_id: "user-1",
      created_at: "2026-08-01T10:00:00Z",
      updated_at: "2026-08-01T10:00:00Z",
      ...overrides,
    };
  }

  it("starts a listless task private, assigned to whoever is typing it", () => {
    const draft = emptyTaskDraft(privateDraftDefaults("me-1"));
    expect(draft.onlyMe).toBe(true);
    expect(draft.assigneeIds).toEqual(["me-1"]);
  });

  it("stays private when the viewer's profile id has not loaded", () => {
    // Fails CLOSED. `owner_id` is stamped from auth.uid() server-side, so the
    // row is still correctly ours without an assignee to point at.
    const draft = emptyTaskDraft(privateDraftDefaults(null));
    expect(draft.onlyMe).toBe(true);
    expect(draft.assigneeIds).toEqual([]);
  });

  it("sends a scope only when the task has no list", () => {
    const priv = emptyTaskDraft({ name: "Poklon", onlyMe: true });
    expect(taskDraftToCreateInput(priv, null).scope).toBe("personal");
    expect(taskDraftToCreateInput(emptyTaskDraft({ name: "Mleko" }), null).scope).toBe("family");
    // Inside a list the trigger overwrites whatever we send, so we send nothing.
    expect(taskDraftToCreateInput(priv, "list-1").scope).toBeUndefined();
  });

  it("mirrors that rule on update", () => {
    const priv = emptyTaskDraft({ name: "Poklon", onlyMe: true });
    expect(taskDraftToUpdateInput(priv, null, null).scope).toBe("personal");
    expect(taskDraftToUpdateInput(priv, null, "list-1").scope).toBeUndefined();
  });

  it("reads a saved task back into the switch", () => {
    expect(taskToDraft(task({ scope: "personal" }), []).onlyMe).toBe(true);
    expect(taskToDraft(task({ scope: "family" }), []).onlyMe).toBe(false);
    // A listed task's scope is its LIST's, so the per-task switch is off - the
    // editor disables it there and the hint speaks for the list instead.
    expect(taskToDraft(task({ list_id: "list-1", scope: "personal" }), []).onlyMe).toBe(false);
  });
});

/**
 * `completion_mode` - who a tick speaks for. The column and every reader of it
 * shipped with 015; what is pinned here is the rule that decides when the form
 * is allowed to send anything but `shared`, because sending it anywhere else
 * would leave a row in a mode that nothing in the app can act on.
 */
describe("completion mode", () => {
  const twoPeople = { assigneeIds: ["ana", "marko"] };

  it("defaults to shared", () => {
    expect(emptyTaskDraft().completionMode).toBe("shared");
    expect(taskDraftToCreateInput(emptyTaskDraft({ name: "Mleko" }), null).completion_mode).toBe(
      "shared",
    );
  });

  it("sends per_assignee for a repeating task with two or more people", () => {
    const draft = emptyTaskDraft({
      name: "Izneti smeće",
      dueDate: TODAY,
      recurrencePeriod: "daily",
      completionMode: "per_assignee",
      ...twoPeople,
    });
    expect(taskDraftToCreateInput(draft, null).completion_mode).toBe("per_assignee");
  });

  it("falls back to shared when the task stops repeating", () => {
    const draft = emptyTaskDraft({
      name: "Izneti smeće",
      dueDate: TODAY,
      recurrencePeriod: "one-time",
      completionMode: "per_assignee",
      ...twoPeople,
    });
    expect(taskDraftToCreateInput(draft, null).completion_mode).toBe("shared");
  });

  it("falls back to shared when it loses its date, so the repeat cannot anchor", () => {
    const draft = emptyTaskDraft({
      name: "Izneti smeće",
      recurrencePeriod: "daily",
      completionMode: "per_assignee",
      ...twoPeople,
    });
    expect(taskDraftToCreateInput(draft, null).completion_mode).toBe("shared");
  });

  it("falls back to shared when only one person is left on it", () => {
    const draft = emptyTaskDraft({
      name: "Izneti smeće",
      dueDate: TODAY,
      recurrencePeriod: "daily",
      completionMode: "per_assignee",
      assigneeIds: ["ana"],
    });
    // One person's own copy IS the whole occurrence - the modes cannot differ.
    expect(taskDraftToCreateInput(draft, null).completion_mode).toBe("shared");
  });

  it("applies the same rule on update", () => {
    const draft = emptyTaskDraft({
      name: "Izneti smeće",
      dueDate: TODAY,
      recurrencePeriod: "daily",
      completionMode: "per_assignee",
      ...twoPeople,
    });
    expect(taskDraftToUpdateInput(draft, null, null).completion_mode).toBe("per_assignee");
    expect(taskDraftToUpdateInput({ ...draft, assigneeIds: [] }, null, null).completion_mode).toBe(
      "shared",
    );
  });

  it("reads the saved mode back, and says so on the recurrence chip", () => {
    const draft = emptyTaskDraft({
      dueDate: TODAY,
      recurrencePeriod: "daily",
      completionMode: "per_assignee",
      ...twoPeople,
    });
    expect(taskRecurrenceSummary(draft)).toBe("Svaki dan · svako svoje");
    // Alone on it, the mode is not a thing worth reading back.
    expect(taskRecurrenceSummary({ ...draft, assigneeIds: ["ana"] })).toBe("Svaki dan");
    expect(taskRecurrenceSummary({ ...draft, completionMode: "shared" })).toBe("Svaki dan");
  });
});
