import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Type-only, so this does NOT defeat the `vi.mock` below - the import is erased.
import type { ToggleTaskInput } from "@/hooks/useTasks";
import type { ListWithTasks, Task, TaskOccurrence } from "@/types/database";
import { taskOccurrenceKey } from "@/utils/task";

/**
 * The row reaches for four hooks whose import chain ends at `lib/supabase`, and
 * CI has no Supabase env - importing any of them for real fails there before a
 * single assertion runs (see `project_ci_no_supabase_env`). Each is mocked as a
 * standalone factory, never through `importOriginal`, which would pull the real
 * module in anyway.
 */
const toggleMutate = vi.fn<(input: ToggleTaskInput) => void>();
let occurrences: TaskOccurrence[] = [];
let lists: ListWithTasks[] = [];
let viewerId: string | null = "parent-1";

vi.mock("@/hooks/useTasks", () => ({
  useToggleTask: () => ({ mutate: toggleMutate, isPending: false }),
  useListsWithTasks: () => ({ data: lists }),
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

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ profile: viewerId ? { id: viewerId } : null, familyId: "f1" }),
}));

// Pinned, not stubbed out: the row now asks whether an instance has come due
// yet, and a test whose answer depends on the machine's clock would start
// failing on its own one morning.
const TODAY = "2026-08-14";
vi.mock("@/hooks/useToday", () => ({
  useToday: () => ({ str: TODAY, date: new Date(`${TODAY}T12:00:00`) }),
}));

// Rendered as a marker so the assignee assertions can see it without dragging
// the roster query (and the Supabase client) into the run.
vi.mock("@/components/common/MemberBadges", () => ({
  MemberBadges: ({ personIds }: { personIds: string[] }) => (
    <span data-testid="member-badges">{personIds.join(",")}</span>
  ),
}));

import { TaskRow, type TaskAgendaItem } from "@/components/tasks/TaskRow";

const baseTask: Task = {
  id: "t1",
  list_id: null,
  family_id: "f1",
  owner_id: "parent-1",
  scope: "family",
  name: "Izbaci smeće",
  description: null,
  is_completed: false,
  completed_at: null,
  completed_by_person_id: null,
  due_date: "2026-08-10",
  due_time: null,
  recurrence_period: null,
  recurrence_interval: 1,
  recurrence_weekdays: null,
  recurrence_until: null,
  completion_mode: "shared",
  remind_minutes_before: null,
  remind_days_before: null,
  sort_order: 1,
  created_by_id: "parent-1",
  updated_by_id: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

function taskItem(overrides: Partial<TaskAgendaItem> = {}): TaskAgendaItem {
  return {
    kind: "task",
    date: "2026-08-10",
    sortKey: 1442,
    task: baseTask,
    occurrenceDate: "2026-08-10",
    dueTime: null,
    assigneeIds: [],
    isDone: false,
    missed: false,
    ...overrides,
  };
}

function renderRow(item: TaskAgendaItem, props: { showTime?: boolean } = {}) {
  const onClick = vi.fn<() => void>();
  render(<TaskRow item={item} onClick={onClick} showTime={props.showTime} />);
  return { onClick };
}

/** The row's own tap target - the circle is a checkbox, never a button. */
function rowButton(): HTMLElement {
  return screen.getByRole("button");
}

beforeEach(() => {
  toggleMutate.mockClear();
  occurrences = [];
  lists = [];
  viewerId = "parent-1";
});

describe("TaskRow markup", () => {
  it("keeps the circle a SIBLING of the row button, never nested inside it", () => {
    // The whole reason `ItemCard` grew a `leading` slot: a control inside a
    // <button> is invalid HTML and the browser swallows its clicks.
    renderRow(taskItem());
    const circle = screen.getByRole("checkbox");
    expect(circle.closest("button")).toBeNull();
    expect(rowButton()).not.toContainElement(circle);
  });

  it("positions the circle, which is what keeps the app frame from scrolling", () => {
    // The checkbox is `sr-only`, i.e. `position: absolute`. Without a positioned
    // ancestor its containing block became the app's screen area, ABOVE the
    // scroll container - so the input escaped that container's clipping, sat
    // hundreds of pixels below the fold in the FRAME's coordinate space, made
    // the frame scrollable, and focusing one on a tap scrolled the whole app up
    // (measured: 280px, bottom bar stranded mid-screen). jsdom has no Tailwind
    // stylesheet to compute from, so the class itself is what gets pinned.
    renderRow(taskItem());
    const label = screen.getByLabelText('Označi „Izbaci smeće" kao završeno').closest("label");
    expect(label?.className).toContain("relative");
  });

  it("names both targets separately - what the tap does, and what it opens", () => {
    renderRow(taskItem());
    expect(screen.getByLabelText('Označi „Izbaci smeće" kao završeno')).toBeInTheDocument();
    expect(screen.getByLabelText('Otvori detalje za „Izbaci smeće"')).toBeInTheDocument();
  });
});

describe("TaskRow completion circle", () => {
  it("ticks the SERIES date, not the date the instance is shown at", () => {
    // A moved occurrence: shown on the 12th, still keyed on the 10th.
    const item = taskItem({
      task: { ...baseTask, recurrence_period: "weekly" },
      date: "2026-08-12",
      occurrenceDate: "2026-08-10",
    });
    renderRow(item);
    screen.getByRole("checkbox").click();
    expect(toggleMutate).toHaveBeenCalledWith({
      task: item.task,
      date: "2026-08-10",
      personId: null,
      done: true,
    });
  });

  it("does not open the detail sheet when the circle is tapped", () => {
    const { onClick } = renderRow(taskItem());
    screen.getByRole("checkbox").click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("opens the detail sheet from the row body", () => {
    const { onClick } = renderRow(taskItem());
    rowButton().click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(toggleMutate).not.toHaveBeenCalled();
  });

  it("unticks a done task", () => {
    renderRow(taskItem({ isDone: true, task: { ...baseTask, is_completed: true } }));
    const circle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(circle.checked).toBe(true);
    circle.click();
    expect(toggleMutate).toHaveBeenCalledWith(
      expect.objectContaining({ done: false, personId: null }),
    );
  });

  it("refuses a repeat that has not come due yet", () => {
    // The reported mess: a daily chore drew a live circle on every visible day
    // of the week strip, and each one wrote a real `done` row for a day nobody
    // had lived through yet.
    const daily = { ...baseTask, recurrence_period: "daily" as const, due_date: "2026-08-10" };
    renderRow(taskItem({ task: daily, date: "2026-08-15", occurrenceDate: "2026-08-15" }));
    const circle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(circle.disabled).toBe(true);
    circle.click();
    expect(toggleMutate).not.toHaveBeenCalled();
  });

  it("still ticks today's instance of that same chore", () => {
    const daily = { ...baseTask, recurrence_period: "daily" as const, due_date: "2026-08-10" };
    renderRow(taskItem({ task: daily, date: TODAY, occurrenceDate: TODAY }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false);
    screen.getByRole("checkbox").click();
    expect(toggleMutate).toHaveBeenCalledWith(expect.objectContaining({ date: TODAY, done: true }));
  });

  it("leaves a one-off alone - finishing that early is normal", () => {
    // A deadline, not an appointment: paying a bill or buying the milk before it
    // is due is exactly what people do.
    renderRow(
      taskItem({
        task: { ...baseTask, due_date: "2026-08-20" },
        date: "2026-08-20",
        occurrenceDate: "2026-08-20",
      }),
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false);
  });

  it("says how many instances of a series an overdue row stands for", () => {
    const daily = { ...baseTask, recurrence_period: "daily" as const, due_date: "2026-08-10" };
    renderRow(
      taskItem({ task: daily, date: "2026-08-11", occurrenceDate: "2026-08-11", lateCount: 3 }),
    );
    expect(screen.getByText("kasni 3")).toBeInTheDocument();
  });

  it("does not count out loud when the row stands for exactly one instance", () => {
    const daily = { ...baseTask, recurrence_period: "daily" as const, due_date: "2026-08-10" };
    renderRow(
      taskItem({ task: daily, date: "2026-08-13", occurrenceDate: "2026-08-13", lateCount: 1 }),
    );
    expect(screen.queryByText(/^kasni/)).toBeNull();
  });
});

describe("TaskRow per-assignee completion", () => {
  const perAssignee: Task = {
    ...baseTask,
    recurrence_period: "daily",
    completion_mode: "per_assignee",
  };

  it("gives somebody the chore was not given to a dead circle and the count", () => {
    // Each assignee owes their own tick, so a third person's tap has no honest
    // meaning - the row counts the answers instead of pretending to be one.
    renderRow(taskItem({ task: perAssignee, assigneeIds: ["kid-1", "kid-2"] }));
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText("0/2")).toBeVisible();
    box.click();
    expect(toggleMutate).not.toHaveBeenCalled();
  });

  it("counts the whole chore while an assignee ticks only their own part", () => {
    // The reported bug: Milan is one of three, ticks his part, and the row read
    // as finished for everybody with nothing saying otherwise.
    occurrences = [
      {
        id: "o1",
        task_id: perAssignee.id,
        family_id: "f1",
        occurrence_date: "2026-08-10",
        person_id: "parent-1",
        status: "done",
        moved_to_date: null,
        completed_at: "2026-08-10T09:00:00Z",
        completed_by_person_id: "parent-1",
        acted_by_person_id: null,
        acted_at: null,
        note: null,
        created_at: "2026-08-10T09:00:00Z",
        updated_at: "2026-08-10T09:00:00Z",
      },
    ];
    renderRow(taskItem({ task: perAssignee, assigneeIds: ["parent-1", "kid-1", "kid-2"] }));
    // His own circle is filled, so he can take it back...
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    // ...but the chore is not finished, and neither the title nor the count says it is.
    expect(screen.getByText("1/3")).toBeVisible();
    expect(screen.getByText("Izbaci smeće")).not.toHaveClass("line-through");
  });

  it("acts on the viewer's own slot when the viewer is an assignee", () => {
    renderRow(taskItem({ task: perAssignee, assigneeIds: ["kid-1", "parent-1"] }));
    screen.getByRole("checkbox").click();
    expect(toggleMutate).toHaveBeenCalledWith(expect.objectContaining({ personId: "parent-1" }));
  });

  it("reads the viewer's own row rather than the whole-occurrence flag", () => {
    // `item.isDone` is false (there is no whole-occurrence row at all) but this
    // viewer's copy exists, so the circle must read as done.
    occurrences = [
      {
        id: "o1",
        task_id: perAssignee.id,
        family_id: "f1",
        occurrence_date: "2026-08-10",
        person_id: "parent-1",
        status: "done",
        moved_to_date: null,
        completed_at: "2026-08-10T09:00:00Z",
        completed_by_person_id: "parent-1",
        acted_by_person_id: null,
        acted_at: null,
        note: null,
        created_at: "2026-08-10T09:00:00Z",
        updated_at: "2026-08-10T09:00:00Z",
      },
    ];
    renderRow(taskItem({ task: perAssignee, assigneeIds: ["kid-1", "parent-1"], isDone: false }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("counts the answers for a bystander, done only when everybody is in", () => {
    occurrences = [
      {
        id: "o1",
        task_id: perAssignee.id,
        family_id: "f1",
        occurrence_date: "2026-08-10",
        person_id: "kid-1",
        status: "done",
        moved_to_date: null,
        completed_at: "2026-08-10T09:00:00Z",
        completed_by_person_id: "kid-1",
        acted_by_person_id: null,
        acted_at: null,
        note: null,
        created_at: "2026-08-10T09:00:00Z",
        updated_at: "2026-08-10T09:00:00Z",
      },
    ];
    renderRow(taskItem({ task: perAssignee, assigneeIds: ["kid-1", "kid-2"] }));
    expect(screen.getByText("1/2")).toBeVisible();
    expect(screen.getByText("Izbaci smeće")).not.toHaveClass("line-through");
  });

  it("still lets a parent tick a child's own shared chore", () => {
    const shared: Task = { ...baseTask, completion_mode: "shared" };
    renderRow(taskItem({ task: shared, assigneeIds: ["kid-1"] }));
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(false);
    box.click();
    expect(toggleMutate).toHaveBeenCalledWith(expect.objectContaining({ personId: null }));
  });

  it("will not let a bystander finish a shared chore split between several", () => {
    const shared: Task = { ...baseTask, completion_mode: "shared" };
    renderRow(taskItem({ task: shared, assigneeIds: ["kid-1", "kid-2"] }));
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    box.click();
    expect(toggleMutate).not.toHaveBeenCalled();
  });
});

describe("TaskRow content", () => {
  it("strikes the title of a done task", () => {
    renderRow(taskItem({ isDone: true }));
    expect(screen.getByText("Izbaci smeće")).toHaveClass("line-through");
  });

  it("flags a missed occurrence", () => {
    renderRow(taskItem({ missed: true }));
    expect(rowButton()).toHaveTextContent("propušteno");
  });

  it("never calls a finished occurrence missed - it was resolved, just late", () => {
    renderRow(taskItem({ missed: true, isDone: true }));
    expect(rowButton()).not.toHaveTextContent("propušteno");
  });

  it("carries the recurrence label and the parent list in the meta line", () => {
    lists = [{ id: "l1", name: "Kućni poslovi" } as ListWithTasks];
    renderRow(
      taskItem({
        task: { ...baseTask, list_id: "l1", recurrence_period: "weekly", recurrence_interval: 1 },
      }),
    );
    expect(rowButton()).toHaveTextContent("Nedeljno · Kućni poslovi");
  });

  it("shows the assignees as member badges", () => {
    renderRow(taskItem({ assigneeIds: ["kid-1", "kid-2"] }));
    expect(screen.getByTestId("member-badges")).toHaveTextContent("kid-1,kid-2");
  });

  it("keeps a timed task's clock in the trailing slot", () => {
    renderRow(taskItem({ dueTime: "17:30" }));
    expect(rowButton()).toHaveTextContent("17:30");
  });

  it("drops the clock where the host already prints it (Danas' gutter)", () => {
    renderRow(taskItem({ dueTime: "17:30" }), { showTime: false });
    expect(rowButton()).not.toHaveTextContent("17:30");
  });

  it("prints no clock for an untimed task", () => {
    renderRow(taskItem());
    expect(rowButton().textContent ?? "").not.toMatch(/\d{2}:\d{2}/);
  });

  it("repeats the passed deadline when the overdue block hands it one", () => {
    render(<TaskRow item={taskItem()} onClick={vi.fn<() => void>()} dateLabel="3. avg" />);
    expect(rowButton()).toHaveTextContent("rok 3. avg");
  });

  it("says nothing about a deadline without one", () => {
    renderRow(taskItem());
    expect(rowButton()).not.toHaveTextContent("rok");
  });
});
