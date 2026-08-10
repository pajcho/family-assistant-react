import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Task } from "@/types/database";

// The chip renders assignee badges, and that hook reaches the Supabase client at
// import time - CI has no env for it.
vi.mock("@/components/common/MemberBadges", () => ({ MemberBadges: () => null }));

import {
  AllDayChip,
  isAllDayItem,
  type PositionedEntry,
  TimedBlock,
} from "@/components/dashboard/agendaCalendarShared";
import type { AgendaItem } from "@/hooks/useAgenda";

const task: Task = {
  id: "t1",
  list_id: null,
  family_id: "f1",
  owner_id: "parent-1",
  scope: "family",
  name: "Popij lek",
  description: null,
  is_completed: false,
  completed_at: null,
  completed_by_person_id: null,
  due_date: "2026-08-10",
  due_time: "17:30:00",
  recurrence_period: "daily",
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

function taskItem(overrides: Partial<Extract<AgendaItem, { kind: "task" }>> = {}): AgendaItem {
  return {
    kind: "task",
    date: "2026-08-10",
    sortKey: 1050,
    task,
    occurrenceDate: "2026-08-10",
    dueTime: "17:30",
    assigneeIds: [],
    isDone: false,
    missed: false,
    ...overrides,
  };
}

/** What the week grid's lane sweep hands a block: a full 24px minimum slot. */
function positioned(item: AgendaItem): PositionedEntry {
  return {
    item,
    startTime: "17:30",
    endTime: "17:30",
    lane: 1,
    totalLanes: 1,
    laneSpan: 1,
    topPx: 200,
    heightPx: 24,
  };
}

describe("task placement on the time axis", () => {
  it("puts a timed task on the clock and an untimed one in the all-day strip", () => {
    expect(isAllDayItem(taskItem())).toBe(false);
    expect(isAllDayItem(taskItem({ dueTime: null }))).toBe(true);
  });

  it("draws a timed task as a point, not as a block that occupies time", () => {
    render(
      <div>
        <TimedBlock
          block={positioned(taskItem())}
          todayStr="2026-08-10"
          nowMin={9 * 60}
          onClick={() => {}}
        />
      </div>,
    );
    const marker = screen.getByRole("button");
    // Pinned to its minute, but NOT stretched to the slot the lane sweep
    // reserved: a reminder has no duration to draw.
    expect(marker.style.top).toBe("200px");
    expect(marker.style.height).toBe("");
    expect(marker).toHaveClass("h-[22px]");
    expect(marker).toHaveTextContent("Popij lek");
    // A duration block prints its range; a point has none to print.
    expect(marker.textContent ?? "").not.toContain("-");
  });

  it("strikes a finished marker through", () => {
    render(
      <div>
        <TimedBlock
          block={positioned(taskItem({ isDone: true }))}
          todayStr="2026-08-10"
          nowMin={9 * 60}
          onClick={() => {}}
        />
      </div>,
    );
    expect(screen.getByText("Popij lek")).toHaveClass("line-through");
  });

  it("names an untimed task in its all-day chip", () => {
    render(<AllDayChip item={taskItem({ dueTime: null })} onClick={() => {}} />);
    expect(screen.getByRole("button")).toHaveTextContent("Popij lek");
  });
});
