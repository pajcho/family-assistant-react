import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task, TaskOccurrence } from "@/types/database";
import { taskOccurrenceKey } from "@/utils/task";

/**
 * The history is the only place the app admits that a repeat was skipped, moved
 * or forgotten, and the only route back from the first two - `restoreOccurrence`
 * shipped implemented and called by nothing, which is how a skipped day became
 * unreachable. So what is pinned here is exactly that: the four things that can
 * have happened to a day, who is named for each, and which of them offer a way
 * back.
 */
const TODAY = "2026-08-14";

let occurrences: TaskOccurrence[] = [];

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

vi.mock("@/hooks/useFamilyMembers", () => ({
  useFamilyMembers: () => ({
    byId: new Map([
      ["p1", { first_name: "Ana", last_name: "Perić" }],
      ["p2", { first_name: "Milan", last_name: "Perić" }],
    ]),
  }),
}));

import { TaskHistoryList, TaskLateList } from "@/components/tasks/TaskHistoryPanel";

const daily: Task = {
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
  recurrence_period: "daily",
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
};

function makeOccurrence(overrides: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return {
    id: "o1",
    task_id: "t1",
    family_id: "f1",
    occurrence_date: "2026-08-11",
    person_id: null,
    status: "done",
    moved_to_date: null,
    completed_at: null,
    completed_by_person_id: null,
    acted_by_person_id: null,
    acted_at: null,
    note: null,
    created_at: "2026-08-11T10:00:00Z",
    updated_at: "2026-08-11T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  occurrences = [];
});

describe("TaskHistoryList", () => {
  it("names the four things that can have happened to a day", () => {
    // Anchored on the 10th, so the past holds four days and only three of them
    // have a row - the fourth is what "Propušteno" means.
    const fromTenth = { ...daily, due_date: "2026-08-10" };
    occurrences = [
      makeOccurrence({
        occurrence_date: "2026-08-11",
        status: "done",
        completed_at: "2026-08-11T18:42:00Z",
        completed_by_person_id: "p1",
      }),
      makeOccurrence({
        id: "o2",
        occurrence_date: "2026-08-12",
        status: "skipped",
        acted_by_person_id: "p2",
        acted_at: "2026-08-12T09:10:00Z",
      }),
      makeOccurrence({
        id: "o3",
        occurrence_date: "2026-08-13",
        status: "moved",
        moved_to_date: "2026-08-20",
        acted_by_person_id: "p1",
      }),
    ];
    render(
      <TaskHistoryList task={fromTenth} assigneeIds={[]} today={TODAY} onRestore={() => {}} />,
    );

    expect(screen.getByText(/Završeno · Ana/)).toBeInTheDocument();
    // The half the data never carried before: who made the call.
    expect(screen.getByText(/Preskočeno · Milan/)).toBeInTheDocument();
    expect(screen.getByText(/Pomereno na 20\.08\.2026 · Ana/)).toBeInTheDocument();
    // No row at all for a past day means nobody ever answered for it.
    expect(screen.getByText("Propušteno")).toBeInTheDocument();
  });

  it("offers a way back from a skip and a move, and from nothing else", () => {
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-11", status: "done" }),
      makeOccurrence({ id: "o2", occurrence_date: "2026-08-12", status: "skipped" }),
    ];
    render(<TaskHistoryList task={daily} assigneeIds={[]} today={TODAY} onRestore={() => {}} />);
    // Three past days: done, skipped, and the 13th nobody resolved. Only the
    // skip is undoable - un-ticking belongs to the tick, and a day that simply
    // passed has nothing to take back.
    expect(screen.getAllByRole("button", { name: "Vrati" })).toHaveLength(1);
  });

  it("hands back the SERIES date, which is what an occurrence row keys on", () => {
    const onRestore = vi.fn<(date: string) => void>();
    occurrences = [
      makeOccurrence({
        occurrence_date: "2026-08-12",
        status: "moved",
        moved_to_date: "2026-08-13",
      }),
    ];
    render(<TaskHistoryList task={daily} assigneeIds={[]} today={TODAY} onRestore={onRestore} />);
    screen.getByRole("button", { name: "Vrati" }).click();
    expect(onRestore).toHaveBeenCalledWith("2026-08-12");
  });

  it("finishes a per_assignee day only once everybody has ticked", () => {
    const chore = { ...daily, completion_mode: "per_assignee" as const, due_date: "2026-08-13" };
    const first = makeOccurrence({
      occurrence_date: "2026-08-13",
      person_id: "p1",
      status: "done",
    });

    occurrences = [first];
    const one = render(
      <TaskHistoryList
        task={chore}
        assigneeIds={["p1", "p2"]}
        today={TODAY}
        onRestore={() => {}}
      />,
    );
    // One of two, so the day is not answered for yet.
    expect(screen.getByText("Propušteno")).toBeInTheDocument();
    one.unmount();

    occurrences = [
      first,
      makeOccurrence({ id: "o2", occurrence_date: "2026-08-13", person_id: "p2", status: "done" }),
    ];
    render(
      <TaskHistoryList
        task={chore}
        assigneeIds={["p1", "p2"]}
        today={TODAY}
        onRestore={() => {}}
      />,
    );
    expect(screen.getByText("Završeno 2/2")).toBeInTheDocument();
  });

  it("shows a skip made TODAY, which is the whole reason this view exists", () => {
    // Straight from the maintainer's own data: today's occurrence was skipped,
    // so the agenda dropped it and there was no screen in the app that admitted
    // it existed. Today is not "past", so the projection cannot reach it - only
    // the row pass can.
    occurrences = [makeOccurrence({ occurrence_date: TODAY, status: "skipped" })];
    render(<TaskHistoryList task={daily} assigneeIds={[]} today={TODAY} onRestore={() => {}} />);
    expect(screen.getByText("14.08.2026")).toBeInTheDocument();
    expect(screen.getByText("Preskočeno")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vrati" })).toBeInTheDocument();
  });

  it("shows a FUTURE occurrence somebody moved or skipped ahead of time", () => {
    // The action a person is most likely to want back, and the one no past
    // window can reach.
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-16", status: "skipped" }),
      makeOccurrence({
        id: "o2",
        occurrence_date: "2026-08-17",
        status: "moved",
        moved_to_date: "2026-08-19",
      }),
    ];
    render(<TaskHistoryList task={daily} assigneeIds={[]} today={TODAY} onRestore={() => {}} />);
    expect(screen.getByText("16.08.2026")).toBeInTheDocument();
    expect(screen.getByText("Pomereno na 19.08.2026")).toBeInTheDocument();
    // Newest first, so the days ahead lead.
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("17.08.2026");
  });

  it("reproduces the maintainer's own chore, row for row", () => {
    // "Test za Jelenu": daily from the 12th, three assignees each ticking their
    // own copy, Milan done on the 12th, today skipped, the 15th moved and the
    // 17th skipped. Every one of those has to be visible and, where it applies,
    // undoable.
    const chore = {
      ...daily,
      name: "Test za Jelenu",
      due_date: "2026-08-12",
      completion_mode: "per_assignee" as const,
    };
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-12", person_id: "p1", status: "done" }),
      makeOccurrence({ id: "o2", occurrence_date: TODAY, status: "skipped" }),
      makeOccurrence({
        id: "o3",
        occurrence_date: "2026-08-15",
        status: "moved",
        moved_to_date: "2026-08-15",
      }),
      makeOccurrence({ id: "o4", occurrence_date: "2026-08-17", status: "skipped" }),
    ];
    render(
      <TaskHistoryList
        task={chore}
        assigneeIds={["p1", "p2", "p3"]}
        today={TODAY}
        onRestore={() => {}}
      />,
    );
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
    // 17, 14, 13, 12 - but NOT the 15th: that row moves the day onto itself, so
    // nothing happened to it (see the no-op test below).
    expect(rows).toHaveLength(4);
    expect(rows.join("|")).toContain("17.08.2026");
    expect(rows.join("|")).toContain("14.08.2026");
    expect(rows.join("|")).not.toContain("15.08.2026");
    expect(screen.getAllByRole("button", { name: "Vrati" })).toHaveLength(2);
  });

  it("does not report a move that landed on the day it started from", () => {
    // Moving an occurrence and moving it straight back leaves a row behind. It
    // used to read "15.08.2026 - Pomereno na 15.08.2026", which says nothing
    // twice and looks like a bug to anybody reading their own history.
    occurrences = [
      makeOccurrence({
        occurrence_date: "2026-08-16",
        status: "moved",
        moved_to_date: "2026-08-16",
      }),
      // The same shape in the PAST is still a day that passed unresolved, and
      // that is worth saying - just not as a move.
      makeOccurrence({
        id: "o2",
        occurrence_date: "2026-08-12",
        status: "moved",
        moved_to_date: "2026-08-12",
      }),
    ];
    render(<TaskHistoryList task={daily} assigneeIds={[]} today={TODAY} onRestore={() => {}} />);
    expect(screen.queryByText(/Pomereno/)).toBeNull();
    expect(screen.queryByText("16.08.2026")).toBeNull();
    expect(screen.getByText("12.08.2026")).toBeInTheDocument();
  });

  it("names who has already done their part, and how much is still missing", () => {
    const chore = { ...daily, completion_mode: "per_assignee" as const, due_date: "2026-08-13" };
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-13", person_id: "p1", status: "done" }),
    ];
    render(
      <TaskHistoryList
        task={chore}
        assigneeIds={["p1", "p2"]}
        today={TODAY}
        onRestore={() => {}}
      />,
    );
    expect(screen.getByText("1/2 · Ana · fali još 1")).toBeInTheDocument();
  });

  it("says so when there is nothing to show", () => {
    const fresh = { ...daily, due_date: TODAY };
    render(<TaskHistoryList task={fresh} assigneeIds={[]} today={TODAY} onRestore={() => {}} />);
    expect(screen.getByText(/Nema zabeleženih ponavljanja/)).toBeInTheDocument();
  });
});

describe("TaskLateList", () => {
  it("lists every unresolved past day, oldest first, one row each", () => {
    render(
      <TaskLateList
        task={daily}
        assigneeIds={[]}
        today={TODAY}
        personId={null}
        canTick
        onComplete={() => {}}
        onSkip={() => {}}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("11.08.2026");
  });

  it("resolves ONE day per row, under its own series date", () => {
    const onComplete = vi.fn<(date: string) => void>();
    const onSkip = vi.fn<(date: string) => void>();
    render(
      <TaskLateList
        task={daily}
        assigneeIds={[]}
        today={TODAY}
        personId={null}
        canTick
        onComplete={onComplete}
        onSkip={onSkip}
      />,
    );
    screen.getAllByRole("checkbox")[0].click();
    // The second argument is the state being ASKED for, not the current one:
    // these circles read and write the viewer's own slot, so a day they already
    // finished unticks instead of pointlessly re-finishing.
    expect(onComplete).toHaveBeenCalledWith("2026-08-11", true);
    screen.getAllByRole("button", { name: "Preskoči" })[1].click();
    expect(onSkip).toHaveBeenCalledWith("2026-08-12");
  });

  it("carries the same progress line as the history", () => {
    // A late day is rarely all-or-nothing when three people owe it separately,
    // and a bare date would hide the one who did do it from whoever is deciding
    // what to do with the day.
    const chore = { ...daily, completion_mode: "per_assignee" as const, due_date: "2026-08-13" };
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-13", person_id: "p2", status: "done" }),
    ];
    render(
      <TaskLateList
        task={chore}
        assigneeIds={["p1", "p2"]}
        today={TODAY}
        personId={null}
        canTick
        onComplete={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText("1/2 · Milan · fali još 1")).toBeInTheDocument();
  });

  it("shows the viewer's own tick, and offers to take it back", () => {
    // A day stays owed until everybody has ticked, so it can sit in this list
    // with the viewer's part already done. The circle used to be hard-coded
    // empty there, which invited a tap that re-sent "finish it" and changed
    // nothing at all.
    const chore = { ...daily, completion_mode: "per_assignee" as const, due_date: "2026-08-13" };
    const onComplete = vi.fn<(date: string, done: boolean) => void>();
    occurrences = [
      makeOccurrence({ occurrence_date: "2026-08-13", person_id: "p2", status: "done" }),
    ];
    render(
      <TaskLateList
        task={chore}
        assigneeIds={["p1", "p2"]}
        today={TODAY}
        personId="p2"
        canTick
        onComplete={onComplete}
        onSkip={() => {}}
      />,
    );
    const circle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(circle.checked).toBe(true);
    circle.click();
    expect(onComplete).toHaveBeenCalledWith("2026-08-13", false);
  });

  it("greys the circles for somebody the chore was not given to", () => {
    render(
      <TaskLateList
        task={daily}
        assigneeIds={["p1"]}
        today={TODAY}
        personId={null}
        canTick={false}
        onComplete={() => {}}
        onSkip={() => {}}
      />,
    );
    for (const circle of screen.getAllByRole("checkbox")) {
      expect(circle).toBeDisabled();
    }
  });
});
