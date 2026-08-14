import { useState } from "react";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SmartListKey } from "@/components/tasks/smartLists";
import type { TaskAgendaItem } from "@/components/tasks/taskItemModel";
import type { ListScope, ListWithTasks, Task } from "@/types/database";

/**
 * The /tasks index below `lg`, per plan 016 sections 6-7 as shipped: the
 * `Zadaci | Liste` segment splits the screen, the lists grid groups by scope
 * under "Sve" and follows this device's MRU, and the stat tiles swap one of the
 * four cross-list cuts into the page instead of navigating away (the shipped
 * form of the plan's "Pregled" row - see 016 section 13).
 *
 * Every Supabase-touching hook is mocked with a standalone factory (never
 * `importOriginal`) - CI has no Supabase env. The order helpers, the tile
 * strip and the grid cards are real; the rows and the cut bodies are stubs,
 * because what is under test is which of them the screen shows.
 */

const state = vi.hoisted(() => ({
  lists: [] as ListWithTasks[],
}));

// jsdom has no ResizeObserver; the chip rows watch their own overflow with one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#list">{children}</a>,
  useNavigate: () => vi.fn<(options: unknown) => void>(),
}));

vi.mock("@/hooks/useToday", () => ({
  useToday: () => ({ str: "2026-08-10", date: new Date(2026, 7, 10) }),
}));

vi.mock("@/hooks/useSearchDialog", () => ({
  useSearchDialog: () => ({ openSearch: vi.fn<() => void>() }),
}));

vi.mock("@/components/tasks/useCreateListFlow", () => ({
  useCreateListFlow: () => ({
    openAdd: vi.fn<() => void>(),
    openAddWithName: vi.fn<(name: string) => void>(),
    dialog: null,
  }),
}));

vi.mock("@/hooks/useTasks", () => ({
  useListsWithTasks: () => ({ data: state.lists, isLoading: false }),
  useTasksList: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useOverdueTasks", () => ({
  useOverdueTasks: () => ({
    items: [item("t-late", "Iznesi đubre", "2026-08-08", { missed: true })],
    isLoading: false,
  }),
}));

// The section headings count what is still owed, which for a `per_assignee`
// chore means asking the occurrence rows per person - see `outstandingCount`.
vi.mock("@/hooks/useTaskOccurrences", () => ({
  useTaskOccurrenceRows: () => ({ occurrences: [], byKey: new Map(), isLoading: false }),
}));

vi.mock("@/components/tasks/taskItems", () => ({
  useSmartListCounts: () => ({ late: 1, scheduled: 2, inbox: 0, done: 4 }),
  useTaskAgendaItems: () => ({
    items: [
      item("t-today", "Operi sudove", "2026-08-10"),
      item("t-tomorrow", "Zalij cveće", "2026-08-11"),
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useAgenda", () => ({
  agendaItemKey: (entry: TaskAgendaItem) => `${entry.task.id}:${entry.date}`,
}));

vi.mock("@/components/common/MemberFilterChips", () => ({
  MemberFilterChips: () => null,
}));

vi.mock("@/components/tasks/TaskRow", () => ({
  TaskRow: ({ item: entry }: { item: TaskAgendaItem }) => <div>{entry.task.name}</div>,
}));

vi.mock("@/components/tasks/TaskDetailSheet", () => ({
  TaskDetailSheet: () => null,
}));

vi.mock("@/components/tasks/TaskQuickAddFlow", () => ({
  TaskQuickAddFlow: () => null,
}));

vi.mock("@/components/tasks/CompletedTasksScreen", () => ({
  CompletedTasksBody: () => <div>completed-cut-body</div>,
}));

vi.mock("@/components/tasks/SmartTaskListScreen", () => ({
  SmartTaskListBody: ({ source }: { source: SmartListKey }) => <div>smart-cut-body:{source}</div>,
}));

import { TasksIndexScreen, type TasksTab } from "@/components/tasks/TasksIndexScreen";

const BASE_TASK: Task = {
  id: "t0",
  list_id: null,
  family_id: "fam-1",
  owner_id: "viewer-1",
  scope: "family",
  name: "",
  description: null,
  is_completed: false,
  completed_at: null,
  completed_by_person_id: null,
  due_date: "2026-08-10",
  due_time: null,
  recurrence_period: "one-time",
  recurrence_interval: 1,
  recurrence_weekdays: null,
  recurrence_until: null,
  completion_mode: "shared",
  remind_minutes_before: null,
  remind_days_before: null,
  sort_order: 1,
  created_by_id: "viewer-1",
  updated_by_id: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

function item(
  id: string,
  name: string,
  date: string,
  overrides: Partial<TaskAgendaItem> = {},
): TaskAgendaItem {
  return {
    kind: "task",
    date,
    sortKey: 1441,
    task: { ...BASE_TASK, id, name, due_date: date },
    occurrenceDate: date,
    dueTime: null,
    assigneeIds: [],
    isDone: false,
    missed: false,
    ...overrides,
  };
}

function list(id: string, name: string, scope: ListScope, updatedAt: string): ListWithTasks {
  return {
    id,
    family_id: "fam-1",
    owner_id: "viewer-1",
    updated_by_id: null,
    name,
    description: null,
    scope,
    sort_order: 0,
    smart_sort_enabled: false,
    auto_delete_completed_after_hours: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: updatedAt,
    tasks: [],
  };
}

const DEFAULT_LISTS = [
  list("l-shopping", "Šoping", "family", "2026-08-09T00:00:00Z"),
  list("l-chores", "Radovi", "family", "2026-08-07T00:00:00Z"),
  list("l-own", "Obaveze", "personal", "2026-08-05T00:00:00Z"),
];

/** The screen as the route wires it: tab and cut held above, handed back down. */
function Harness({ tab = "tasks", cut = null }: { tab?: TasksTab; cut?: SmartListKey | null }) {
  const [tabState, setTabState] = useState<TasksTab>(tab);
  const [cutState, setCutState] = useState<SmartListKey | null>(cut);
  return (
    <TasksIndexScreen
      tab={tabState}
      onTabChange={setTabState}
      cut={cutState}
      onCutChange={setCutState}
    />
  );
}

function gridNames(): string[] {
  return screen.getAllByRole("link").map((tile) => tile.textContent?.match(/^[^\d]+/)?.[0] ?? "");
}

describe("TasksIndexScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    state.lists = DEFAULT_LISTS;
  });

  it("opens on the dated work and switches to the lists on the segment", () => {
    render(<Harness />);

    // The work first: late, today, tomorrow - not a grid of containers.
    expect(screen.getByRole("heading", { name: /Kasni/ })).toBeInTheDocument();
    expect(screen.getByText("Iznesi đubre")).toBeInTheDocument();
    expect(screen.getByText("Operi sudove")).toBeInTheDocument();
    expect(screen.getByText("Zalij cveće")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Liste" }));
    expect(screen.getByText("Šoping")).toBeInTheDocument();
    expect(screen.queryByText("Iznesi đubre")).not.toBeInTheDocument();
  });

  it("renders the grid first when it opens on ?tab=lists", () => {
    render(<Harness tab="lists" />);
    expect(screen.getByText("Šoping")).toBeInTheDocument();
    expect(screen.queryByText("Operi sudove")).not.toBeInTheDocument();
  });

  it("groups the grid by scope under Sve and drops the headings on a pick", () => {
    render(<Harness tab="lists" />);

    expect(screen.getByRole("heading", { name: /Porodične/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Lične/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lične" }));
    expect(screen.queryByRole("heading", { name: /Porodične/ })).not.toBeInTheDocument();
    expect(screen.getByText("Obaveze")).toBeInTheDocument();
    expect(screen.queryByText("Šoping")).not.toBeInTheDocument();
  });

  it("renders no heading for an empty scope group", () => {
    state.lists = DEFAULT_LISTS.filter((entry) => entry.scope === "family");
    render(<Harness tab="lists" />);
    expect(screen.getByRole("heading", { name: /Porodične/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Lične/ })).not.toBeInTheDocument();
  });

  it("orders the grid by this device's memory, then by activity", () => {
    const { unmount } = render(<Harness tab="lists" />);
    // No memory yet: family group by `updated_at`, newest first, then personal.
    expect(gridNames()).toEqual(["Šoping", "Radovi", "Obaveze"]);
    unmount();

    window.localStorage.setItem("lists.recentIds.v1", JSON.stringify(["l-chores"]));
    render(<Harness tab="lists" />);
    expect(gridNames()).toEqual(["Radovi", "Šoping", "Obaveze"]);
  });

  it("swaps a cut in place of the dated sections, and back off the active tile", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Zakazano/ }));
    expect(screen.getByText("smart-cut-body:scheduled")).toBeInTheDocument();
    expect(screen.queryByText("Operi sudove")).not.toBeInTheDocument();

    // The tile stays put and pressed - tapping it again returns the default.
    const active = screen.getByRole("button", { name: /Zakazano/ });
    expect(active).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(active);
    expect(screen.queryByText("smart-cut-body:scheduled")).not.toBeInTheDocument();
    expect(screen.getByText("Operi sudove")).toBeInTheDocument();
  });

  it("gives Završeno its own body, grouped by tick day rather than due day", () => {
    render(<Harness cut="done" />);
    expect(screen.getByText("completed-cut-body")).toBeInTheDocument();
    expect(screen.queryByText("Operi sudove")).not.toBeInTheDocument();
  });
});
