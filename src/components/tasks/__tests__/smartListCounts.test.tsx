import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskOccurrence } from "@/types/database";
import { taskOccurrenceKey } from "@/utils/task";

/**
 * What the four tiles say, and the one promise they have to keep: a tile is the
 * COUNT OF THE LIST IT OPENS. Three ways that used to break, one test each:
 *
 *   - "Kasni 3" over a list of 7, because the tile counted with `isTaskOverdue`
 *     (false for every repeat by design) while the list is `useOverdueTasks`;
 *   - a task counted merely for HAVING a date, so an ended series and a chore
 *     ticked three months ahead both sat in "Zakazano" with nothing to do;
 *   - a `per_assignee` chore counted as owed by somebody who had already ticked
 *     their own copy, because "done" was asked of the occurrence rather than of
 *     the person the rail had picked.
 *
 * Every dependency is mocked as a standalone factory: the real chain ends at
 * `lib/supabase`, and CI has no Supabase env (see `project_ci_no_supabase_env`).
 */
const TODAY = "2026-08-14";

let tasks: Task[] = [];
let assignees = new Map<string, string[]>();
let occurrences: TaskOccurrence[] = [];

vi.mock("@/hooks/useTasks", () => ({
  useTasksList: () => ({ data: tasks, isLoading: false }),
}));
vi.mock("@/hooks/useTaskAssignees", () => ({
  useTaskAssignees: () => ({ byTask: assignees, isLoading: false }),
}));
vi.mock("@/hooks/useTaskOccurrences", () => ({
  useTaskOccurrenceRows: () => {
    const byKey = new Map<string, TaskOccurrence[]>();
    for (const row of occurrences) {
      const key = taskOccurrenceKey(row.task_id, row.occurrence_date);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row);
      else byKey.set(key, [row]);
    }
    return { occurrences, byKey, isLoading: false };
  },
}));
vi.mock("@/hooks/useToday", () => ({
  useToday: () => ({ str: TODAY, date: new Date(`${TODAY}T12:00:00`) }),
}));
vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ profile: { id: "p1" }, familyId: "f1" }),
}));

import { useSmartListCounts } from "@/components/tasks/taskItems";
import { useOverdueTasks } from "@/hooks/useOverdueTasks";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    list_id: "l1",
    family_id: "f1",
    owner_id: "u1",
    scope: "family",
    name: "Izbaci smeće",
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
    created_by_id: "u1",
    updated_by_id: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeOccurrence(overrides: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return {
    id: "o1",
    task_id: "t1",
    family_id: "f1",
    occurrence_date: TODAY,
    person_id: null,
    status: "done",
    moved_to_date: null,
    completed_at: `${TODAY}T10:00:00Z`,
    completed_by_person_id: "p1",
    acted_by_person_id: "p1",
    acted_at: `${TODAY}T10:00:00Z`,
    note: null,
    created_at: `${TODAY}T10:00:00Z`,
    updated_at: `${TODAY}T10:00:00Z`,
    ...overrides,
  };
}

const counts = (personIds?: ReadonlySet<string>) =>
  renderHook(() => useSmartListCounts(personIds)).result.current;

const lateRows = (personIds?: ReadonlySet<string>) =>
  renderHook(() => useOverdueTasks(personIds)).result.current.items;

beforeEach(() => {
  tasks = [];
  assignees = new Map();
  occurrences = [];
});

describe("useSmartListCounts - Kasni", () => {
  it("counts repeating chores with missed days, not just one-offs", () => {
    tasks = [
      makeTask({ id: "one-off", due_date: "2026-08-09" }),
      makeTask({ id: "chore", due_date: "2026-08-11", recurrence_period: "daily" }),
    ];
    // The bug this replaces: 1, over a list of 2.
    expect(counts().late).toBe(2);
  });

  it("is exactly the number of rows the Kasni list renders", () => {
    tasks = [
      makeTask({ id: "one-off", due_date: "2026-08-09" }),
      makeTask({ id: "chore", due_date: "2026-08-11", recurrence_period: "daily" }),
      makeTask({ id: "later", due_date: "2026-08-20" }),
      makeTask({ id: "done", due_date: "2026-08-09", is_completed: true }),
    ];
    expect(counts().late).toBe(lateRows().length);
  });

  it("stops counting a chore for the person who has ticked their own copy", () => {
    tasks = [
      makeTask({
        id: "chore",
        due_date: "2026-08-13",
        recurrence_period: "daily",
        completion_mode: "per_assignee",
      }),
    ];
    assignees = new Map([["chore", ["p1", "p2"]]]);
    occurrences = [
      makeOccurrence({ task_id: "chore", occurrence_date: "2026-08-13", person_id: "p1" }),
    ];

    // The family still owes it - p2 has not ticked - but p1 does not.
    expect(counts().late).toBe(1);
    expect(counts(new Set(["p2"])).late).toBe(1);
    expect(counts(new Set(["p1"])).late).toBe(0);
    expect(lateRows(new Set(["p1"]))).toHaveLength(0);
  });
});

describe("useSmartListCounts - Zakazano and Inbox", () => {
  it("counts a repeating chore once, however many times it lands in the window", () => {
    tasks = [makeTask({ id: "chore", due_date: TODAY, recurrence_period: "daily" })];
    expect(counts().scheduled).toBe(1);
  });

  it("drops a series that has nothing left to do", () => {
    tasks = [
      makeTask({
        id: "ended",
        due_date: "2026-01-01",
        recurrence_period: "weekly",
        recurrence_until: "2026-02-01",
      }),
    ];
    // It has a date and it is not "completed" - the old rule counted it - but
    // the list it opens shows nothing at all.
    expect(counts().scheduled).toBe(0);
  });

  it("drops a one-off dated past the window the list shows", () => {
    tasks = [makeTask({ id: "far", due_date: "2027-06-01" })];
    expect(counts().scheduled).toBe(0);
  });

  it("keeps counting an overdue one-off, which Zakazano leads with", () => {
    tasks = [makeTask({ id: "late", due_date: "2026-08-09" })];
    expect(counts()).toMatchObject({ late: 1, scheduled: 1 });
  });

  it("counts listless tasks with something left, dated or not", () => {
    tasks = [
      makeTask({ id: "someday", list_id: null }),
      makeTask({ id: "dated", list_id: null, due_date: "2026-08-20" }),
      makeTask({ id: "finished", list_id: null, is_completed: true }),
      makeTask({ id: "in-a-list", due_date: "2026-08-20" }),
    ];
    expect(counts().inbox).toBe(2);
  });

  it("leaves out the people a task was not given to", () => {
    tasks = [
      makeTask({ id: "mine", list_id: null, due_date: "2026-08-20" }),
      makeTask({ id: "theirs", list_id: null, due_date: "2026-08-20" }),
      // No assignees at all: family work, which belongs to nobody in particular.
      makeTask({ id: "everyones", list_id: null, due_date: "2026-08-20" }),
    ];
    assignees = new Map([
      ["mine", ["p1"]],
      ["theirs", ["p2"]],
    ]);
    expect(counts(new Set(["p1"]))).toMatchObject({ scheduled: 1, inbox: 1 });
  });
});
