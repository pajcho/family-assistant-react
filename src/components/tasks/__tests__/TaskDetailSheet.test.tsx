import { describe, expect, it, vi } from "vitest";

import type { Task } from "@/types/database";

/**
 * The two branching pieces of domain copy - the delete question and the skip
 * confirmation - are exercised here, because both are pure and both are where
 * this sheet says what an action will actually do. Everything else in the module
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
  useTaskOccurrences: () => ({
    byKey: new Map(),
    skipOccurrence: {},
    moveOccurrence: {},
    restoreOccurrence: {},
  }),
  useTaskOccurrenceRows: () => ({ byKey: new Map(), occurrences: [], isLoading: false }),
}));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ profile: null, familyId: null }) }));
vi.mock("@/hooks/useFamilyMembers", () => ({ useFamilyMembers: () => ({ byId: new Map() }) }));
vi.mock("@/components/common/MemberBadges", () => ({ MemberBadges: () => null }));
vi.mock("@/components/common/DateField", () => ({ DateField: () => null }));
// The editor the sheet stacks as a sub-view reaches Supabase through the
// assignee picker; stubbing the module cuts that whole chain in one line.
vi.mock("@/components/tasks/TaskEditDialog", () => ({ TaskEditForm: () => null }));

import { taskDeleteCopy, taskSkipCopy } from "@/components/tasks/TaskDetailSheet";

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
    // Named for the write it performs. One write under two different words - one
    // of them "obriši" - is what made this menu unreadable.
    expect(copy.occurrence?.label).toBe("Preskoči ovo ponavljanje");
    expect(copy.occurrence?.note).toContain("za sve");
    expect(copy.series.label).toBe("Cela serija");
  });

  it("drops the date from the question when there is none to name", () => {
    const copy = taskDeleteCopy(repeating, null);
    expect(copy.occurrence).not.toBeNull();
    expect(copy.message).not.toContain("(");
  });

  it("withdraws the skip answer once the day is finished", () => {
    // Skip and completion share one slot, so "samo ovo ponavljanje" on a day
    // everybody already finished would quietly delete their work.
    const copy = taskDeleteCopy(repeating, "2026-08-10", true);
    expect(copy.occurrence).toBeNull();
    expect(copy.message).toContain("već završeno");
    expect(copy.series.note).toContain("sva njegova ponavljanja");
  });
});

describe("taskSkipCopy", () => {
  it("names every assignee a skip takes the day away from", () => {
    const copy = taskSkipCopy(repeating, { dates: ["2026-08-14"], all: false }, [
      "Milan",
      "Jelena",
      "Ana",
    ]);
    expect(copy.title).toBe("Preskoči ponavljanje");
    expect(copy.message).toContain("14.08.2026");
    expect(copy.message).toContain("Milan, Jelena, Ana");
    // The half people asked about: a skip is not personal.
    expect(copy.message).toContain("za sve kojima je zadatak dodeljen");
    // And the half that makes it feel reversible, because it is.
    expect(copy.message).toContain("istorije");
    expect(copy.confirm).toBe("Preskoči");
  });

  it("says the family when a chore belongs to nobody in particular", () => {
    const copy = taskSkipCopy(repeating, { dates: ["2026-08-14"], all: false }, []);
    expect(copy.message).toContain("za celu porodicu");
    expect(copy.message).not.toContain("()");
  });

  it("names the work a skip does NOT throw away", () => {
    // The half that makes this a fair choice to offer: Milan did his part, and
    // skipping the day for the other two leaves his tick standing.
    const one = taskSkipCopy(
      repeating,
      { dates: ["2026-08-14"], all: false },
      ["Milan", "Jelena", "Ana"],
      ["Milan"],
    );
    expect(one.message).toContain("Milan je već završio/la svoj deo");
    // Exact about WHERE it survives. The tick really is kept - a skip writes
    // only the whole-occurrence row - but the day drops off every list including
    // that person's, so "the tick stays" on its own would read as "they will
    // still see it, finished".
    expect(one.message).toContain("ostaje zabeleženo u istoriji");
    expect(one.message).toContain("vraća se ako vratite ovaj dan");
    expect(one.message).toContain("nestaje sa njihovih spiskova");

    const two = taskSkipCopy(
      repeating,
      { dates: ["2026-08-14"], all: false },
      ["Milan", "Jelena", "Ana"],
      ["Milan", "Jelena"],
    );
    expect(two.message).toContain("Milan, Jelena su već završili");
    expect(two.message).toContain("ostaje zabeleženo u istoriji");

    // Who finished follows the number of PEOPLE; what you would restore follows
    // the number of DAYS. Branching both off one count is how a two-day skip
    // ended up offering to restore "ovaj dan".
    const manyDays = taskSkipCopy(
      repeating,
      { dates: ["2026-08-12", "2026-08-13"], all: true },
      ["Milan", "Jelena", "Ana"],
      ["Milan"],
    );
    expect(manyDays.message).toContain("Milan je već završio/la svoj deo");
    expect(manyDays.message).toContain("vratite ove dane");
    expect(manyDays.message).not.toContain("vratite ovaj dan");
  });

  it("says nothing about completions when there are none", () => {
    const copy = taskSkipCopy(repeating, { dates: ["2026-08-14"], all: false }, ["Ana"], []);
    expect(copy.message).not.toContain("zabeležen");
  });

  it("counts the days when the whole backlog is being skipped at once", () => {
    const copy = taskSkipCopy(
      repeating,
      { dates: ["2026-08-11", "2026-08-12", "2026-08-13"], all: true },
      ["Ana"],
    );
    expect(copy.title).toBe("Preskoči sve zaostalo");
    expect(copy.message).toContain("Izbaci smeće");
    expect(copy.confirm).toBe("Preskoči sve");
  });

  it("agrees the count with the noun AND both verbs", () => {
    // "2 zaostalih ponavljanja otpada" is not something a person would say, and
    // the count is dynamic, so all three have to follow it.
    const dates = (n: number) =>
      Array.from({ length: n }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);
    const message = (n: number) =>
      taskSkipCopy(repeating, { dates: dates(n), all: true }, []).message;

    expect(message(1)).toContain("1 zaostalo ponavljanje");
    expect(message(1)).toContain("otpada za celu porodicu i nestaje");
    expect(message(3)).toContain("3 zaostala ponavljanja");
    expect(message(3)).toContain("otpadaju za celu porodicu i nestaju");
    expect(message(5)).toContain("5 zaostalih ponavljanja");
    expect(message(5)).toContain("otpada za celu porodicu i nestaje");
  });
});
