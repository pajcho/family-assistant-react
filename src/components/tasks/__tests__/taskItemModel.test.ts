import { describe, expect, it } from "vitest";

import {
  assigneeProgress,
  isItemOutstanding,
  taskTickSlot,
  matchesPersonFilter,
  nextTaskInstance,
  taskAgendaItem,
  undatedTaskInstance,
  type TaskAgendaItem,
} from "@/components/tasks/taskItemModel";
import type { Task, TaskOccurrence } from "@/types/database";
import { taskOccurrenceKey } from "@/utils/task";

/**
 * The /tasks row model. Three things are worth pinning down here, because each of
 * them is a bug you would only notice in somebody's hand:
 *
 *   - which instance a REPEATING task's single row inside a list stands for;
 *   - whose occurrence slot one checkbox owns under `per_assignee`, since the
 *     read and the write have to agree or the tick does not stick;
 *   - that a row's `date` is the EFFECTIVE date while its `occurrenceDate` stays
 *     the series date, which is what every write keys on.
 *
 * Imports the pure module: the hooks next door reach `lib/supabase`, and CI has
 * no Supabase env.
 */

const TODAY = "2026-08-10"; // a Monday

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    list_id: "list-1",
    family_id: "fam-1",
    owner_id: "user-1",
    scope: "family",
    name: "Izneti smeće",
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

function occurrence(overrides: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return {
    id: "occ-1",
    task_id: "task-1",
    family_id: "fam-1",
    occurrence_date: TODAY,
    person_id: null,
    status: "done",
    moved_to_date: null,
    completed_at: "2026-08-10T08:00:00Z",
    completed_by_person_id: "p1",
    acted_by_person_id: null,
    acted_at: null,
    note: null,
    created_at: "2026-08-10T08:00:00Z",
    updated_at: "2026-08-10T08:00:00Z",
    ...overrides,
  };
}

/**
 * Local copy of `occurrencesByKeyFrom` - importing the hook module would drag
 * `lib/supabase` into a test, which is exactly what fails on CI.
 */
function occurrencesByKeyFrom(rows: readonly TaskOccurrence[]): Map<string, TaskOccurrence[]> {
  const map = new Map<string, TaskOccurrence[]>();
  for (const row of rows) {
    const key = taskOccurrenceKey(row.task_id, row.occurrence_date);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

const NO_OCCURRENCES = new Map<string, TaskOccurrence[]>();
/** The rail on "Svi" - the family's own answer. */
const NO_PEOPLE: ReadonlySet<string> = new Set();

describe("nextTaskInstance", () => {
  it("has nothing to point at for an undated task", () => {
    expect(nextTaskInstance(task(), TODAY, NO_OCCURRENCES)).toBeNull();
  });

  it("points a one-off at its own due date, past or future", () => {
    expect(nextTaskInstance(task({ due_date: "2026-08-04" }), TODAY, NO_OCCURRENCES)).toMatchObject(
      {
        occurrenceDate: "2026-08-04",
        effectiveDate: "2026-08-04",
      },
    );
    expect(nextTaskInstance(task({ due_date: "2026-09-01" }), TODAY, NO_OCCURRENCES)).toMatchObject(
      {
        occurrenceDate: "2026-09-01",
      },
    );
  });

  it("points a daily chore anchored long ago at today", () => {
    const daily = task({ due_date: "2026-01-01", recurrence_period: "daily" });
    expect(nextTaskInstance(daily, TODAY, NO_OCCURRENCES)?.occurrenceDate).toBe(TODAY);
  });

  it("skips past a skipped occurrence to the next real one", () => {
    const daily = task({ due_date: "2026-01-01", recurrence_period: "daily" });
    const byKey = occurrencesByKeyFrom([occurrence({ status: "skipped", completed_at: null })]);
    expect(nextTaskInstance(daily, TODAY, byKey)?.occurrenceDate).toBe("2026-08-11");
  });

  it("still finds a monthly chore whose next turn is weeks away", () => {
    const monthly = task({ due_date: "2026-01-28", recurrence_period: "monthly" });
    expect(nextTaskInstance(monthly, TODAY, NO_OCCURRENCES)?.occurrenceDate).toBe("2026-08-28");
  });

  it("reports where a moved occurrence sits, keyed by the date the series says", () => {
    const weekly = task({ due_date: "2026-08-10", recurrence_period: "weekly" });
    const byKey = occurrencesByKeyFrom([
      occurrence({ status: "moved", moved_to_date: "2026-08-12", completed_at: null }),
    ]);
    const instance = nextTaskInstance(weekly, TODAY, byKey);
    expect(instance?.occurrenceDate).toBe(TODAY);
    expect(instance?.effectiveDate).toBe("2026-08-12");
  });

  it("has nothing left to point at once a bounded series has ended", () => {
    const ended = task({
      due_date: "2026-01-01",
      recurrence_period: "weekly",
      recurrence_until: "2026-02-01",
    });
    expect(nextTaskInstance(ended, TODAY, NO_OCCURRENCES)).toBeNull();
  });
});

/**
 * Who may tick a task off. The whole rule is "you cannot finish work that is
 * not yours", and the interesting arm is the last one: a chore split between
 * two people, seen by a third, has no single slot their tap could mean.
 */
describe("taskTickSlot", () => {
  it("lets anybody finish a task nobody was given", () => {
    expect(taskTickSlot(task(), [], "p3")).toEqual({
      personId: null,
      canTick: true,
      aggregate: false,
    });
  });

  it("is the whole occurrence for a shared task, and its own people may tick", () => {
    const shared = task();
    expect(taskTickSlot(shared, ["p1", "p2"], "p2")).toEqual({
      personId: null,
      canTick: true,
      aggregate: false,
    });
  });

  it("lets anybody tick a shared chore that belongs to exactly one person", () => {
    // A child's chore ticked off by the parent standing next to them. There is
    // one answer and no ambiguity about whose it is.
    expect(taskTickSlot(task(), ["kid-1"], "parent-1").canTick).toBe(true);
  });

  it("keeps a bystander out of a shared chore split between several", () => {
    const shared = task();
    expect(taskTickSlot(shared, ["p1", "p2"], "p3").canTick).toBe(false);
    expect(taskTickSlot(shared, ["p1", "p2"], null).canTick).toBe(false);
  });

  it("is the viewer's own copy when the viewer is an assignee", () => {
    const chore = task({ completion_mode: "per_assignee" });
    expect(taskTickSlot(chore, ["p1", "p2"], "p2")).toEqual({
      personId: "p2",
      canTick: true,
      aggregate: false,
    });
  });

  it("gives a non-assignee no slot at all, however many people are on it", () => {
    const chore = task({ completion_mode: "per_assignee" });
    // Including the one-assignee case: "svako svoje" means the person themselves,
    // so the on-behalf shortcut that shared tasks get does not apply here.
    expect(taskTickSlot(chore, ["kid-1"], "parent-1")).toEqual({
      personId: null,
      canTick: false,
      aggregate: true,
    });
    expect(taskTickSlot(chore, ["kid-1", "kid-2"], "parent-1")).toEqual({
      personId: null,
      canTick: false,
      aggregate: true,
    });
  });
});

describe("assigneeProgress", () => {
  const chore = task({
    due_date: TODAY,
    recurrence_period: "daily",
    completion_mode: "per_assignee",
  });

  it("counts how many of them have ticked their own copy", () => {
    const byKey = new Map([
      [
        taskOccurrenceKey(chore.id, TODAY),
        [occurrence({ occurrence_date: TODAY, person_id: "kid-1", status: "done" })],
      ],
    ]);
    expect(assigneeProgress(chore, ["kid-1", "kid-2"], TODAY, byKey)).toEqual({
      done: 1,
      total: 2,
    });
  });

  it("is complete only when every one of them is in", () => {
    const byKey = new Map([
      [
        taskOccurrenceKey(chore.id, TODAY),
        [
          occurrence({ occurrence_date: TODAY, person_id: "kid-1", status: "done" }),
          occurrence({ occurrence_date: TODAY, person_id: "kid-2", status: "done" }),
        ],
      ],
    ]);
    const progress = assigneeProgress(chore, ["kid-1", "kid-2"], TODAY, byKey);
    expect(progress.done).toBe(progress.total);
  });
});

describe("matchesPersonFilter", () => {
  const item = (assigneeIds: string[]): TaskAgendaItem =>
    taskAgendaItem(
      task({ due_date: TODAY }),
      undatedTaskInstance(task({ due_date: TODAY }), TODAY),
      assigneeIds,
      TODAY,
    );

  it("lets everything through when nothing is selected", () => {
    expect(matchesPersonFilter(item([]), new Set())).toBe(true);
    expect(matchesPersonFilter(item(["p1"]), new Set())).toBe(true);
  });

  it("keeps only the selected people's rows - a family-wide task is nobody's", () => {
    expect(matchesPersonFilter(item(["p1"]), new Set(["p1"]))).toBe(true);
    expect(matchesPersonFilter(item(["p2"]), new Set(["p1"]))).toBe(false);
    expect(matchesPersonFilter(item([]), new Set(["p1"]))).toBe(false);
  });
});

describe("taskAgendaItem", () => {
  it("shows a row where the override put it while keying writes on the series date", () => {
    const weekly = task({ due_date: TODAY, recurrence_period: "weekly" });
    const byKey = occurrencesByKeyFrom([
      occurrence({ status: "moved", moved_to_date: "2026-08-12", completed_at: null }),
    ]);
    const instance = nextTaskInstance(weekly, TODAY, byKey);
    const row = taskAgendaItem(weekly, instance as NonNullable<typeof instance>, [], TODAY);
    expect(row.date).toBe("2026-08-12");
    expect(row.occurrenceDate).toBe(TODAY);
  });

  it("sorts a timed task at its minute and an all-day one after the day", () => {
    const timed = task({ due_date: TODAY, due_time: "09:30:00" });
    const allDay = task({ due_date: TODAY });
    const instance = {
      occurrenceDate: TODAY,
      effectiveDate: TODAY,
      occurrence: undefined,
      isDone: false,
      isSkipped: false,
    };
    expect(taskAgendaItem(timed, instance, [], TODAY).sortKey).toBe(9 * 60 + 30);
    expect(taskAgendaItem(timed, instance, [], TODAY).dueTime).toBe("09:30");
    expect(taskAgendaItem(allDay, instance, [], TODAY).sortKey).toBe(24 * 60 + 1);
    expect(taskAgendaItem(allDay, instance, [], TODAY).dueTime).toBeNull();
  });

  it("marks only an unresolved PAST repeat as propušteno", () => {
    const weekly = task({ due_date: "2026-08-03", recurrence_period: "weekly" });
    const past = {
      occurrenceDate: "2026-08-03",
      effectiveDate: "2026-08-03",
      occurrence: undefined,
      isDone: false,
      isSkipped: false,
    };
    expect(taskAgendaItem(weekly, past, [], TODAY).missed).toBe(true);

    const done = { ...past, isDone: true };
    expect(taskAgendaItem(weekly, done, [], TODAY).missed).toBe(false);

    // A one-off that slipped is carried over by the overdue block instead.
    const oneOff = task({ due_date: "2026-08-03" });
    expect(taskAgendaItem(oneOff, past, [], TODAY).missed).toBe(false);
  });
});

/**
 * Whose answer a count gives. Every number on /tasks - the four tiles, every
 * section heading - goes through `isItemOutstanding`, so this is where the rule
 * that a person rail changes the QUESTION (not just the row set) is pinned down.
 */
describe("isItemOutstanding", () => {
  const chore = task({
    due_date: TODAY,
    recurrence_period: "daily",
    completion_mode: "per_assignee",
  });
  const instance = {
    occurrenceDate: TODAY,
    effectiveDate: TODAY,
    occurrence: undefined,
    isDone: false,
    isSkipped: false,
  };
  const row = (personId: string) =>
    occurrence({ id: `occ-${personId}`, person_id: personId, status: "done" as const });

  it("asks the family when the rail is on everybody", () => {
    const item = taskAgendaItem(chore, instance, ["p1", "p2"], TODAY);
    const oneDone = occurrencesByKeyFrom([row("p1")]);
    // One of two has ticked, so the chore is not finished - and `item.isDone` is
    // false here whatever happens, which is exactly why it cannot be the test.
    expect(isItemOutstanding(item, oneDone, NO_PEOPLE)).toBe(true);

    const bothDone = occurrencesByKeyFrom([row("p1"), row("p2")]);
    expect(isItemOutstanding(item, bothDone, NO_PEOPLE)).toBe(false);
  });

  it("asks only the picked people when the rail is filtered", () => {
    const item = taskAgendaItem(chore, instance, ["p1", "p2"], TODAY);
    const oneDone = occurrencesByKeyFrom([row("p1")]);
    // p1 has done their part: nothing is owed BY p1, everything still is by p2.
    expect(isItemOutstanding(item, oneDone, new Set(["p1"]))).toBe(false);
    expect(isItemOutstanding(item, oneDone, new Set(["p2"]))).toBe(true);
    expect(isItemOutstanding(item, oneDone, new Set(["p1", "p2"]))).toBe(true);
  });

  it("treats a shared tick and a skipped day as settled for everybody", () => {
    const shared = task({ due_date: TODAY, recurrence_period: "daily" });
    const done = taskAgendaItem(shared, { ...instance, isDone: true }, ["p1"], TODAY);
    expect(isItemOutstanding(done, NO_OCCURRENCES, NO_PEOPLE)).toBe(false);
    expect(isItemOutstanding(done, NO_OCCURRENCES, new Set(["p1"]))).toBe(false);

    const skipped = taskAgendaItem(shared, { ...instance, isSkipped: true }, ["p1"], TODAY);
    expect(isItemOutstanding(skipped, NO_OCCURRENCES, NO_PEOPLE)).toBe(false);
  });
});
