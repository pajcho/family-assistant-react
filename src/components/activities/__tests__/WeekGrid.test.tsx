import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ResolvedActivityBlock } from "@/utils/activity";

import { WeekGrid } from "../WeekGrid";

const block = (
  id: string,
  startTime: string,
  endTime: string,
): ResolvedActivityBlock => ({
  scheduleId: id,
  activityId: "act",
  personId: "p1",
  date: "2026-05-25",
  dayOfWeek: 0, // Monday
  startTime,
  endTime,
  weekPattern: "every",
  recurrenceIntervalWeeks: 1,
});

const blockWidths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button[style]"))
    .map((el) => el.style.width)
    .filter((w) => w.startsWith("calc"));

describe("WeekGrid block widths", () => {
  it("renders a 5-block overlap chain at 50% width, not 20%", () => {
    // Sequential classes + two straddling activities: group size 5, peak
    // overlap 2. Before the fix this divided the column into 5 and left ~60%
    // empty on the right.
    const { container } = render(
      <WeekGrid
        weekStart="2026-05-25"
        blocks={[
          block("E", "09:55", "10:40"),
          block("Solfedjo", "10:20", "11:05"),
          block("S", "10:45", "11:30"),
          block("Klavir", "11:10", "11:55"),
          block("F", "11:35", "12:20"),
        ]}
        activitiesById={new Map()}
        peopleById={new Map()}
      />,
    );
    const widths = blockWidths(container);
    expect(widths).toHaveLength(5);
    for (const w of widths) expect(w).toBe("calc(50% - 4px)");
  });
});
