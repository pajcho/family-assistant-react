import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskOccurrence } from "@/types/database";
import { taskOccurrenceKey } from "@/utils/task";

/**
 * What the overdue block is told, which is not the same as what is late.
 *
 * A one-off is late as a ROW and gets one row. A repeat is late per INSTANCE and
 * still gets one row - dated to the oldest unresolved one and carrying
 * `lateCount` - because a daily chore nobody has touched for a week would
 * otherwise be the entire block, seven times over.
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

import { useOverdueTasks } from "@/hooks/useOverdueTasks";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    list_id: null,
    family_id: "f1",
    owner_id: "u1",
    scope: "family",
    name: "Izbaci smeće",
    description: null,
    is_completed: false,
    completed_at: null,
    completed_by_person_id: null,
    due_date: "2026-08-11",
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
    occurrence_date: "2026-08-11",
    person_id: null,
    status: "done",
    moved_to_date: null,
    completed_at: "2026-08-11T10:00:00Z",
    completed_by_person_id: "p1",
    acted_by_person_id: "p1",
    acted_at: "2026-08-11T10:00:00Z",
    note: null,
    created_at: "2026-08-11T10:00:00Z",
    updated_at: "2026-08-11T10:00:00Z",
    ...overrides,
  };
}

const items = () => renderHook(() => useOverdueTasks()).result.current.items;
const itemsFor = (personIds: ReadonlySet<string>) =>
  renderHook(() => useOverdueTasks(personIds)).result.current.items;
/** Narrowed to the task arm - the only one this hook's task half emits. */
const taskIds = (rows: ReturnType<typeof items>) =>
  rows.flatMap((row) => (row.kind === "task" ? [row.task.id] : []));

beforeEach(() => {
  tasks = [];
  assignees = new Map();
  occurrences = [];
});

describe("useOverdueTasks", () => {
  it("carries a one-off past its due date, once", () => {
    tasks = [makeTask({ due_date: "2026-08-09" })];
    const out = items();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "task",
      date: "2026-08-09",
      occurrenceDate: "2026-08-09",
    });
    // A one-off is one instance, so it never counts out loud.
    expect((out[0] as { lateCount?: number }).lateCount).toBeUndefined();
  });

  it("leaves a one-off that is due today or finished alone", () => {
    tasks = [
      makeTask({ id: "today", due_date: TODAY }),
      makeTask({ id: "done", due_date: "2026-08-09", is_completed: true }),
      makeTask({ id: "someday", due_date: null }),
    ];
    expect(items()).toHaveLength(0);
  });

  it("collapses a repeat's unresolved instances into ONE row, dated to the oldest", () => {
    tasks = [makeTask({ recurrence_period: "daily", due_date: "2026-08-11" })];
    const out = items();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      date: "2026-08-11",
      // Ticking straight from the overdue block resolves the OLDEST debt, so the
      // row has to be keyed to it and not to the instance nearest today.
      occurrenceDate: "2026-08-11",
      lateCount: 3,
      // The in-place "propušteno" treatment belongs to the past day itself; a
      // row that did both would tell you off twice for one thing.
      missed: false,
    });
  });

  it("counts down as instances are resolved, and disappears at zero", () => {
    tasks = [makeTask({ recurrence_period: "daily", due_date: "2026-08-11" })];
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-11", status: "done" }),
      makeOccurrence({ id: "o2", occurrence_date: "2026-08-12", status: "skipped" }),
    ];
    const out = items();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: "2026-08-13", lateCount: 1 });

    occurrences.push(makeOccurrence({ id: "o3", occurrence_date: "2026-08-13", status: "done" }));
    expect(items()).toHaveLength(0);
  });

  it("does not report a repeat whose late instance was moved into the future", () => {
    // Fridays (4 in the schema's Monday-first indexing), anchored on the 7th, so
    // the 7th is the only instance behind today - and it was moved out of reach.
    tasks = [
      makeTask({ recurrence_period: "weekly", due_date: "2026-08-07", recurrence_weekdays: [4] }),
    ];
    occurrences = [
      makeOccurrence({
        occurrence_date: "2026-08-07",
        status: "moved",
        moved_to_date: "2026-08-21",
      }),
    ];
    expect(items()).toHaveLength(0);
  });

  it("owes a per_assignee chore until every assignee has ticked", () => {
    tasks = [
      makeTask({
        recurrence_period: "daily",
        due_date: "2026-08-13",
        completion_mode: "per_assignee",
      }),
    ];
    assignees = new Map([["t1", ["p1", "p2"]]]);
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-13", person_id: "p1", status: "done" }),
    ];
    expect(items()).toHaveLength(1);

    occurrences.push(
      makeOccurrence({ id: "o2", occurrence_date: "2026-08-13", person_id: "p2", status: "done" }),
    );
    expect(items()).toHaveLength(0);
  });

  it("answers for the people the rail has picked, not just about them", () => {
    tasks = [
      makeTask({ id: "hers", due_date: "2026-08-09" }),
      makeTask({
        id: "chore",
        due_date: "2026-08-13",
        recurrence_period: "daily",
        completion_mode: "per_assignee",
      }),
    ];
    assignees = new Map([
      ["hers", ["p2"]],
      ["chore", ["p1", "p2"]],
    ]);
    occurrences = [
      makeOccurrence({ task_id: "chore", occurrence_date: "2026-08-13", person_id: "p1" }),
    ];

    // Everybody: p2 still owes the chore, and p2's one-off is late too.
    expect(taskIds(items())).toEqual(["hers", "chore"]);
    // p1: not on the one-off at all, and their own copy of the chore is ticked -
    // which only a person-aware answer can tell from "the chore is unfinished".
    expect(taskIds(itemsFor(new Set(["p1"])))).toEqual([]);
    expect(taskIds(itemsFor(new Set(["p2"])))).toEqual(["hers", "chore"]);
  });

  it("sorts everything oldest first, whatever kind it is", () => {
    tasks = [
      makeTask({ id: "recent", due_date: "2026-08-13" }),
      makeTask({ id: "old", due_date: "2026-08-02" }),
      makeTask({ id: "chore", recurrence_period: "daily", due_date: "2026-08-12" }),
    ];
    expect(items().map((item) => item.date)).toEqual(["2026-08-02", "2026-08-12", "2026-08-13"]);
  });
});
