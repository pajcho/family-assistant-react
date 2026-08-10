import { describe, expect, it, vi } from "vitest";

import type { Task } from "@/types/database";

/**
 * Only the delete question is exercised here - it is the sheet's one piece of
 * domain copy that branches, and it is pure. Everything else in the module
 * reaches `lib/supabase` through its hooks, so those are stubbed just far enough
 * for the import to succeed on CI, which has no Supabase env.
 */
vi.mock("@/hooks/useTasks", () => ({
  useDeleteTask: () => ({}),
  useListsWithTasks: () => ({ data: [] }),
  useTasksList: () => ({ data: [] }),
  useToggleTask: () => ({}),
  useUpdateTask: () => ({}),
}));
vi.mock("@/hooks/useTaskOccurrences", () => ({
  useTaskOccurrences: () => ({ byKey: new Map(), skipOccurrence: {}, moveOccurrence: {} }),
}));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ profile: null, familyId: null }) }));
vi.mock("@/components/common/MemberBadges", () => ({ MemberBadges: () => null }));
vi.mock("@/components/common/DateField", () => ({ DateField: () => null }));

import { taskDeleteCopy } from "@/components/tasks/TaskDetailSheet";

const oneOff: Pick<Task, "name" | "recurrence_period"> = {
  name: "Odnesi paket",
  recurrence_period: "one-time",
};
const repeating: Pick<Task, "name" | "recurrence_period"> = {
  name: "Izbaci smeće",
  recurrence_period: "weekly",
};

describe("taskDeleteCopy", () => {
  it("asks a plain, undoable-nothing question for a one-off", () => {
    const copy = taskDeleteCopy(oneOff, "2026-08-10");
    expect(copy.occurrence).toBeNull();
    expect(copy.message).toContain("Odnesi paket");
    expect(copy.message).toContain("ne može opozvati");
  });

  it("treats a null recurrence_period as one-off too", () => {
    expect(taskDeleteCopy({ ...oneOff, recurrence_period: null }, null).occurrence).toBeNull();
  });

  it("offers the two answers for a repeating task, dated", () => {
    const copy = taskDeleteCopy(repeating, "2026-08-10");
    expect(copy.message).toContain("se ponavlja");
    expect(copy.message).toContain("10.08.2026");
    expect(copy.occurrence?.label).toBe("Samo ovo ponavljanje");
    expect(copy.series.label).toBe("Cela serija");
  });

  it("drops the date from the question when there is none to name", () => {
    const copy = taskDeleteCopy(repeating, null);
    expect(copy.occurrence).not.toBeNull();
    expect(copy.message).not.toContain("(");
  });
});
