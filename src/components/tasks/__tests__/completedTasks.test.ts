import { describe, expect, it } from "vitest";

import {
  completedEntries,
  groupCompletedByDay,
  latenessLabel,
  localDay,
} from "@/components/tasks/completedTasks";
import type { Task, TaskOccurrence } from "@/types/database";

/**
 * "Završeno" folds two different records of the same event - a one-off's own
 * `completed_at` and a repeating chore's occurrence row - into one list keyed by
 * the day of the tick. What is worth pinning is that both arms arrive, that a
 * repeating task contributes one entry PER done occurrence, and that lateness is
 * measured against the deadline the occurrence actually had.
 *
 * Imports the pure module - CI has no Supabase env.
 */

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    list_id: null,
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
    occurrence_date: "2026-08-10",
    person_id: null,
    status: "done",
    moved_to_date: null,
    completed_at: "2026-08-10T09:00:00Z",
    completed_by_person_id: "ana",
    acted_by_person_id: null,
    acted_at: null,
    note: null,
    created_at: "2026-08-10T09:00:00Z",
    updated_at: "2026-08-10T09:00:00Z",
    ...overrides,
  };
}

/** Noon UTC, so the local day is the same date in every timezone the app runs in. */
const at = (day: string) => `${day}T12:00:00Z`;

describe("completedEntries", () => {
  it("takes one-offs from the task row", () => {
    const done = task({ is_completed: true, completed_at: at("2026-08-11") });
    const out = completedEntries([done], [], "2026-08-01");
    expect(out).toHaveLength(1);
    expect(out[0].doneOn).toBe("2026-08-11");
    expect(out[0].occurrenceDate).toBeNull();
  });

  it("ignores an unfinished task, and one finished before the window", () => {
    const open = task({ id: "a" });
    const old = task({ id: "b", is_completed: true, completed_at: at("2026-07-01") });
    expect(completedEntries([open, old], [], "2026-08-01")).toEqual([]);
  });

  it("takes one entry per done occurrence of a repeating task", () => {
    const chore = task({ recurrence_period: "daily" });
    const rows = [
      occurrence({ id: "o1", occurrence_date: "2026-08-10", completed_at: at("2026-08-10") }),
      occurrence({ id: "o2", occurrence_date: "2026-08-11", completed_at: at("2026-08-11") }),
      occurrence({ id: "o3", occurrence_date: "2026-08-12", status: "skipped" }),
    ];
    const out = completedEntries([chore], rows, "2026-08-01");
    expect(out.map((e) => e.doneOn)).toEqual(["2026-08-11", "2026-08-10"]);
    // Distinct keys, or React would collapse two days of the same chore into one.
    expect(new Set(out.map((e) => e.key)).size).toBe(2);
  });

  it("drops an occurrence whose task is gone", () => {
    expect(completedEntries([], [occurrence()], "2026-08-01")).toEqual([]);
  });

  it("measures lateness against the deadline, and clamps early to on-time", () => {
    const late = task({
      id: "late",
      due_date: "2026-08-08",
      is_completed: true,
      completed_at: at("2026-08-11"),
    });
    const early = task({
      id: "early",
      due_date: "2026-08-20",
      is_completed: true,
      completed_at: at("2026-08-11"),
    });
    const undated = task({ id: "undated", is_completed: true, completed_at: at("2026-08-11") });
    const out = completedEntries([late, early, undated], [], "2026-08-01");
    const byId = new Map(out.map((entry) => [entry.task.id, entry]));
    expect(byId.get("late")?.daysLate).toBe(3);
    expect(byId.get("early")?.daysLate).toBe(0);
    expect(byId.get("undated")?.daysLate).toBeNull();
  });

  it("measures a moved occurrence against where it moved TO", () => {
    const chore = task({ recurrence_period: "weekly" });
    const moved = occurrence({
      occurrence_date: "2026-08-05",
      moved_to_date: "2026-08-10",
      completed_at: at("2026-08-11"),
    });
    expect(completedEntries([chore], [moved], "2026-08-01")[0].daysLate).toBe(1);
  });

  it("sorts newest day first, newest tick first inside a day", () => {
    const a = task({ id: "a", is_completed: true, completed_at: "2026-08-11T08:00:00Z" });
    const b = task({ id: "b", is_completed: true, completed_at: "2026-08-11T18:00:00Z" });
    const c = task({ id: "c", is_completed: true, completed_at: "2026-08-12T07:00:00Z" });
    const out = completedEntries([a, b, c], [], "2026-08-01");
    expect(out.map((e) => e.task.id)).toEqual(["c", "b", "a"]);
  });
});

describe("groupCompletedByDay", () => {
  it("buckets by day, keeping the newest-first order", () => {
    const a = task({ id: "a", is_completed: true, completed_at: at("2026-08-11") });
    const b = task({ id: "b", is_completed: true, completed_at: at("2026-08-11") });
    const c = task({ id: "c", is_completed: true, completed_at: at("2026-08-12") });
    const groups = groupCompletedByDay(completedEntries([a, b, c], [], "2026-08-01"));
    expect(groups.map((g) => g.day)).toEqual(["2026-08-12", "2026-08-11"]);
    expect(groups[1].items).toHaveLength(2);
  });
});

describe("localDay", () => {
  it("reads the local calendar day, not the UTC one", () => {
    // Whatever the runner's zone, a noon-UTC stamp lands on the same date.
    expect(localDay("2026-08-11T12:00:00Z")).toBe("2026-08-11");
  });
});

describe("latenessLabel", () => {
  it("says the three things it can say", () => {
    expect(latenessLabel(null)).toBeNull();
    expect(latenessLabel(0)).toBe("na vreme");
    expect(latenessLabel(1)).toBe("kasnio 1 dan");
    expect(latenessLabel(4)).toBe("kasnio 4 dana");
  });
});
