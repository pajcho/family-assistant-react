import { describe, expect, it } from "vitest";

import {
  expandTaskOccurrences,
  isMissedOccurrence,
  isRecurringTask,
  isTaskDoneOn,
  isTaskOverdue,
  MAX_TASK_INSTANCES,
  type TaskOccurrenceRecord,
  taskOccurrenceKey,
  type TaskSeries,
} from "./expandTask.ts";

// 2026-06-01 is a Monday, which every weekday case below leans on:
// 0 = Monday .. 6 = Sunday, the schema's convention, never a raw getDay().
const TASK_ID = "task-1";
const ANA = "person-ana";
const BOB = "person-bob";

function task(over: Partial<TaskSeries> = {}): TaskSeries {
  return {
    id: TASK_ID,
    due_date: "2026-06-01",
    recurrence_period: null,
    recurrence_interval: 1,
    recurrence_weekdays: null,
    recurrence_until: null,
    completion_mode: "shared",
    is_completed: false,
    ...over,
  };
}

function occurrence(over: Partial<TaskOccurrenceRecord> = {}): TaskOccurrenceRecord {
  return {
    task_id: TASK_ID,
    occurrence_date: "2026-06-01",
    person_id: null,
    status: "done",
    moved_to_date: null,
    ...over,
  };
}

/** The `{ byKey }` shape useTaskOccurrences hands the expander. */
function byKey(...rows: TaskOccurrenceRecord[]): Map<string, TaskOccurrenceRecord[]> {
  const map = new Map<string, TaskOccurrenceRecord[]>();
  for (const row of rows) {
    const key = taskOccurrenceKey(row.task_id, row.occurrence_date);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

const NONE = new Map<string, TaskOccurrenceRecord[]>();

function dates(t: TaskSeries, from: string, to: string, rows = NONE): string[] {
  return expandTaskOccurrences(t, from, to, rows).map((i) => i.effectiveDate);
}

describe("isRecurringTask", () => {
  it("treats null and one-time alike", () => {
    expect(isRecurringTask({ recurrence_period: null })).toBe(false);
    expect(isRecurringTask({ recurrence_period: "one-time" })).toBe(false);
    expect(isRecurringTask({ recurrence_period: "daily" })).toBe(true);
    expect(isRecurringTask({ recurrence_period: "weekly" })).toBe(true);
    expect(isRecurringTask({ recurrence_period: "monthly" })).toBe(true);
  });
});

describe("expandTaskOccurrences - non-recurring", () => {
  it("yields exactly the due date when it lands inside the range", () => {
    expect(dates(task(), "2026-06-01", "2026-06-30")).toEqual(["2026-06-01"]);
    expect(dates(task({ recurrence_period: "one-time" }), "2026-06-01", "2026-06-30")).toEqual([
      "2026-06-01",
    ]);
  });

  it("yields nothing outside the range, on either side", () => {
    expect(dates(task(), "2026-06-02", "2026-06-30")).toEqual([]);
    expect(dates(task(), "2026-05-01", "2026-05-31")).toEqual([]);
  });

  it("yields nothing for an undated task", () => {
    expect(dates(task({ due_date: null }), "2026-01-01", "2026-12-31")).toEqual([]);
    expect(
      dates(task({ due_date: null, recurrence_period: "daily" }), "2026-01-01", "2026-12-31"),
    ).toEqual([]);
  });

  it("reads completion off is_completed, not off an occurrence row", () => {
    const done = expandTaskOccurrences(
      task({ is_completed: true }),
      "2026-06-01",
      "2026-06-01",
      NONE,
    );
    expect(done[0].isDone).toBe(true);

    // A stray 'done' row on a one-off is not the truth - the column is.
    const stray = expandTaskOccurrences(
      task(),
      "2026-06-01",
      "2026-06-01",
      byKey(occurrence({ status: "done" })),
    );
    expect(stray[0].isDone).toBe(false);
  });
});

describe("expandTaskOccurrences - daily", () => {
  it("steps one day at a time", () => {
    expect(dates(task({ recurrence_period: "daily" }), "2026-06-01", "2026-06-05")).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ]);
  });

  it("honours the interval", () => {
    expect(
      dates(
        task({ recurrence_period: "daily", recurrence_interval: 3 }),
        "2026-06-01",
        "2026-06-12",
      ),
    ).toEqual(["2026-06-01", "2026-06-04", "2026-06-07", "2026-06-10"]);
  });

  it("clips the lower bound without shifting the series phase", () => {
    // The phase belongs to the anchor, so a window that opens mid-series reports
    // the series' own dates rather than restarting on `from`.
    expect(
      dates(
        task({ recurrence_period: "daily", recurrence_interval: 3 }),
        "2026-06-05",
        "2026-06-12",
      ),
    ).toEqual(["2026-06-07", "2026-06-10"]);
  });

  it("crosses a month boundary", () => {
    expect(
      dates(
        task({ due_date: "2026-06-29", recurrence_period: "daily" }),
        "2026-06-29",
        "2026-07-02",
      ),
    ).toEqual(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]);
  });
});

describe("expandTaskOccurrences - weekly", () => {
  it("repeats on the anchor's weekday when no weekday set is stored", () => {
    expect(dates(task({ recurrence_period: "weekly" }), "2026-06-01", "2026-06-30")).toEqual([
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
    ]);
  });

  it("honours the interval in whole weeks", () => {
    expect(
      dates(
        task({ recurrence_period: "weekly", recurrence_interval: 2 }),
        "2026-06-01",
        "2026-06-30",
      ),
    ).toEqual(["2026-06-01", "2026-06-15", "2026-06-29"]);
  });

  it("expands a weekday set with 0 = Monday .. 6 = Sunday", () => {
    // Mon + Wed + Sun, anchored on Monday 2026-06-01.
    expect(
      dates(
        task({ recurrence_period: "weekly", recurrence_weekdays: [0, 2, 6] }),
        "2026-06-01",
        "2026-06-14",
      ),
    ).toEqual(["2026-06-01", "2026-06-03", "2026-06-07", "2026-06-08", "2026-06-10", "2026-06-14"]);
  });

  it("starts at the first listed weekday on or after the anchor", () => {
    // Anchored on Wednesday but listed Mon + Fri: the Friday of the anchor's
    // own week is the first instance, never the Monday that already passed.
    expect(
      dates(
        task({ due_date: "2026-06-03", recurrence_period: "weekly", recurrence_weekdays: [0, 4] }),
        "2026-05-01",
        "2026-06-30",
      ),
    ).toEqual([
      "2026-06-05",
      "2026-06-08",
      "2026-06-12",
      "2026-06-15",
      "2026-06-19",
      "2026-06-22",
      "2026-06-26",
      "2026-06-29",
    ]);
  });

  it("counts an interval in weeks from the anchor's week, not per weekday", () => {
    // Mon + Fri every second week: both days of week A, nothing in week B.
    expect(
      dates(
        task({
          recurrence_period: "weekly",
          recurrence_interval: 2,
          recurrence_weekdays: [0, 4],
        }),
        "2026-06-01",
        "2026-06-30",
      ),
    ).toEqual(["2026-06-01", "2026-06-05", "2026-06-15", "2026-06-19", "2026-06-29"]);
  });

  it("skips the anchor's week entirely when every listed weekday already passed", () => {
    // Anchored on Sunday 2026-06-07 with Mon + Wed listed: the next block.
    expect(
      dates(
        task({ due_date: "2026-06-07", recurrence_period: "weekly", recurrence_weekdays: [0, 2] }),
        "2026-06-01",
        "2026-06-17",
      ),
    ).toEqual(["2026-06-08", "2026-06-10", "2026-06-15", "2026-06-17"]);
  });

  it("ignores out-of-range weekday values and de-duplicates the set", () => {
    expect(
      dates(
        task({ recurrence_period: "weekly", recurrence_weekdays: [2, 2, 9, -1, 0] }),
        "2026-06-01",
        "2026-06-10",
      ),
    ).toEqual(["2026-06-01", "2026-06-03", "2026-06-08", "2026-06-10"]);
  });
});

describe("expandTaskOccurrences - monthly", () => {
  it("steps a month at a time on the anchor's day", () => {
    expect(
      dates(
        task({ due_date: "2026-06-15", recurrence_period: "monthly" }),
        "2026-06-01",
        "2026-09-30",
      ),
    ).toEqual(["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"]);
  });

  it("keeps the 31st anchored instead of drifting down through short months", () => {
    expect(
      dates(
        task({ due_date: "2026-01-31", recurrence_period: "monthly" }),
        "2026-01-01",
        "2026-06-30",
      ),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("recovers the anchor day in a leap February too", () => {
    expect(
      dates(
        task({ due_date: "2028-01-31", recurrence_period: "monthly" }),
        "2028-01-01",
        "2028-03-31",
      ),
    ).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("honours the interval and crosses the year boundary", () => {
    expect(
      dates(
        task({ due_date: "2026-11-30", recurrence_period: "monthly", recurrence_interval: 2 }),
        "2026-11-01",
        "2027-04-30",
      ),
    ).toEqual(["2026-11-30", "2027-01-30", "2027-03-30"]);
  });
});

describe("expandTaskOccurrences - recurrence_until", () => {
  it("includes the end date itself", () => {
    expect(
      dates(
        task({ recurrence_period: "daily", recurrence_until: "2026-06-03" }),
        "2026-06-01",
        "2026-06-30",
      ),
    ).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("does not extend the range when it falls after `to`", () => {
    expect(
      dates(
        task({ recurrence_period: "daily", recurrence_until: "2026-12-31" }),
        "2026-06-01",
        "2026-06-02",
      ),
    ).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("yields nothing for a series that ended before the range opens", () => {
    expect(
      dates(
        task({ recurrence_period: "daily", recurrence_until: "2026-05-30" }),
        "2026-06-01",
        "2026-06-30",
      ),
    ).toEqual([]);
  });
});

describe("expandTaskOccurrences - overrides", () => {
  const daily = task({ recurrence_period: "daily" });

  it("reports a moved occurrence at its new date, keyed on the old one", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-02", status: "moved", moved_to_date: "2026-06-04" }),
    );
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-04", rows);
    expect(out.map((i) => [i.occurrenceDate, i.effectiveDate])).toEqual([
      ["2026-06-01", "2026-06-01"],
      ["2026-06-02", "2026-06-04"],
      ["2026-06-03", "2026-06-03"],
      ["2026-06-04", "2026-06-04"],
    ]);
  });

  it("surfaces an occurrence moved INTO the range from before it", () => {
    // The row keys on 06-02, which is outside [06-03, 06-05], so no enumeration of
    // the window reaches it: the row is a candidate because it carries a
    // `moved_to_date` in range, and its series date is then phase-tested. Output is
    // ordered by the SERIES date, so the moved one leads - callers bucket by
    // effectiveDate anyway, exactly as they do for payments.
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-02", status: "moved", moved_to_date: "2026-06-05" }),
    );
    const out = expandTaskOccurrences(daily, "2026-06-03", "2026-06-05", rows);
    expect(out.map((i) => [i.occurrenceDate, i.effectiveDate])).toEqual([
      ["2026-06-02", "2026-06-05"],
      ["2026-06-03", "2026-06-03"],
      ["2026-06-04", "2026-06-04"],
      ["2026-06-05", "2026-06-05"],
    ]);
  });

  it("drops an occurrence moved OUT of the range", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-02", status: "moved", moved_to_date: "2026-07-01" }),
    );
    expect(dates(daily, "2026-06-01", "2026-06-03", rows)).toEqual(["2026-06-01", "2026-06-03"]);
  });

  it("ignores a moved row with no target date", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-02", status: "moved", moved_to_date: null }),
    );
    expect(dates(daily, "2026-06-01", "2026-06-02", rows)).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("returns a skipped occurrence flagged rather than dropping it", () => {
    const rows = byKey(occurrence({ occurrence_date: "2026-06-02", status: "skipped" }));
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-02", rows);
    expect(out.map((i) => [i.occurrenceDate, i.isSkipped, i.isDone])).toEqual([
      ["2026-06-01", false, false],
      ["2026-06-02", true, false],
    ]);
  });

  it("flags a done occurrence and carries its row", () => {
    const row = occurrence({ occurrence_date: "2026-06-02", status: "done" });
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-02", byKey(row));
    expect(out[1].isDone).toBe(true);
    expect(out[1].occurrence).toBe(row);
    expect(out[0].occurrence).toBeUndefined();
  });

  it("lets a skip outrank one assignee's own done row", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-01", person_id: ANA, status: "done" }),
      occurrence({ occurrence_date: "2026-06-01", status: "skipped" }),
    );
    const out = expandTaskOccurrences(
      task({ recurrence_period: "daily", completion_mode: "per_assignee" }),
      "2026-06-01",
      "2026-06-01",
      rows,
    );
    expect([out[0].isSkipped, out[0].isDone]).toEqual([true, false]);
  });

  it("does not treat one assignee's done row as the whole occurrence", () => {
    const rows = byKey(occurrence({ occurrence_date: "2026-06-01", person_id: ANA }));
    const out = expandTaskOccurrences(
      task({ recurrence_period: "daily", completion_mode: "per_assignee" }),
      "2026-06-01",
      "2026-06-01",
      rows,
    );
    expect(out[0].isDone).toBe(false);
  });

  it("keeps isDone false in per_assignee mode even where a shared tick would answer", () => {
    // The one place `instance.isDone` deliberately says less than `isTaskDoneOn`:
    // isDone is an occurrence-WIDE fact and per_assignee has none, so the digest
    // keeps counting the instance and the row layer asks per person.
    const chore = task({ recurrence_period: "daily", completion_mode: "per_assignee" });
    const rows = byKey(occurrence({ occurrence_date: "2026-06-01", status: "done" }));
    const out = expandTaskOccurrences(chore, "2026-06-01", "2026-06-01", rows);
    expect(out[0].isDone).toBe(false);
    expect(isTaskDoneOn(chore, "2026-06-01", rows)).toBe(true);
  });

  it("keeps a relocated occurrence at its new date after it is ticked off there", () => {
    // There is one row per slot, so ticking a moved occurrence flips `status` to
    // 'done' and leaves `moved_to_date` alone. Placement is `moved_to_date`,
    // resolution is `status`: reading the first off the second would snap this back
    // to the 2nd wearing the 4th's checkmark - and the digest would nag about it.
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-02", status: "done", moved_to_date: "2026-06-04" }),
    );
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-04", rows);
    expect(out.map((i) => [i.occurrenceDate, i.effectiveDate, i.isDone])).toEqual([
      ["2026-06-01", "2026-06-01", false],
      ["2026-06-02", "2026-06-04", true],
      ["2026-06-03", "2026-06-03", false],
      ["2026-06-04", "2026-06-04", false],
    ]);
  });

  it("keeps a relocated occurrence at its new date after it is skipped there", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-02", status: "skipped", moved_to_date: "2026-06-04" }),
    );
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-04", rows);
    expect(out.map((i) => [i.occurrenceDate, i.effectiveDate, i.isSkipped])).toEqual([
      ["2026-06-01", "2026-06-01", false],
      ["2026-06-02", "2026-06-04", true],
      ["2026-06-03", "2026-06-03", false],
      ["2026-06-04", "2026-06-04", false],
    ]);
  });
});

describe("expandTaskOccurrences - the moved-in pass", () => {
  it("pulls an occurrence in from any distance, with no walk to reach it", () => {
    const old = task({ due_date: "2024-01-01", recurrence_period: "daily" });
    const rows = byKey(
      occurrence({ occurrence_date: "2025-03-07", status: "moved", moved_to_date: "2026-06-02" }),
    );
    const out = expandTaskOccurrences(old, "2026-06-01", "2026-06-02", rows);
    expect(out.map((i) => [i.occurrenceDate, i.effectiveDate])).toEqual([
      ["2025-03-07", "2026-06-02"],
      ["2026-06-01", "2026-06-01"],
      ["2026-06-02", "2026-06-02"],
    ]);
  });

  it("pulls one BACK from a series date after the window", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-07-20", status: "moved", moved_to_date: "2026-06-02" }),
    );
    const out = expandTaskOccurrences(
      task({ recurrence_period: "daily" }),
      "2026-06-01",
      "2026-06-02",
      rows,
    );
    expect(out.map((i) => [i.occurrenceDate, i.effectiveDate])).toEqual([
      ["2026-06-01", "2026-06-01"],
      ["2026-06-02", "2026-06-02"],
      ["2026-07-20", "2026-06-02"],
    ]);
  });

  it("will not pull in a date past `recurrence_until`", () => {
    const bounded = task({ recurrence_period: "daily", recurrence_until: "2026-06-03" });
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-10", status: "moved", moved_to_date: "2026-06-02" }),
    );
    expect(dates(bounded, "2026-06-01", "2026-06-03", rows)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });

  it("rejects a row whose series date the rule does not have", () => {
    const everyThird = task({ recurrence_period: "daily", recurrence_interval: 3 });
    // 06-04 IS one of its dates (the 1st, then every third day), so it comes in.
    const aligned = byKey(
      occurrence({ occurrence_date: "2026-06-04", status: "moved", moved_to_date: "2026-06-05" }),
    );
    expect(dates(everyThird, "2026-06-05", "2026-06-06", aligned)).toEqual(["2026-06-05"]);
    // 06-03 never was - a row left behind by an edit to the recurrence. The O(1)
    // phase test rejects it rather than inventing a day the series does not have.
    const stale = byKey(
      occurrence({ occurrence_date: "2026-06-03", status: "moved", moved_to_date: "2026-06-05" }),
    );
    expect(dates(everyThird, "2026-06-05", "2026-06-06", stale)).toEqual([]);
  });

  it("phase-tests a monthly move on the ANCHORED day of the month", () => {
    // Anchored on the 31st, so the series' February date is the 28th.
    const monthly = task({ due_date: "2026-01-31", recurrence_period: "monthly" });
    const real = byKey(
      occurrence({ occurrence_date: "2026-02-28", status: "moved", moved_to_date: "2026-03-02" }),
    );
    const stale = byKey(
      occurrence({ occurrence_date: "2026-02-27", status: "moved", moved_to_date: "2026-03-02" }),
    );
    expect(dates(monthly, "2026-03-01", "2026-03-05", real)).toEqual(["2026-03-02"]);
    expect(dates(monthly, "2026-03-01", "2026-03-05", stale)).toEqual([]);
  });

  it("phase-tests a weekly move on its weekday AND its week block", () => {
    // Mon + Wed every second week from Monday 2026-06-01: 06-03 is the active
    // block's Wednesday, 06-10 is the off week's.
    const biweekly = task({
      recurrence_period: "weekly",
      recurrence_interval: 2,
      recurrence_weekdays: [0, 2],
    });
    const active = byKey(
      occurrence({ occurrence_date: "2026-06-03", status: "moved", moved_to_date: "2026-06-09" }),
    );
    const offWeek = byKey(
      occurrence({ occurrence_date: "2026-06-10", status: "moved", moved_to_date: "2026-06-09" }),
    );
    expect(dates(biweekly, "2026-06-08", "2026-06-12", active)).toEqual(["2026-06-09"]);
    expect(dates(biweekly, "2026-06-08", "2026-06-12", offWeek)).toEqual([]);
  });
});

describe("expandTaskOccurrences - runaway cap", () => {
  it("returns at most MAX_TASK_INSTANCES instances", () => {
    const out = expandTaskOccurrences(
      task({ due_date: "2020-01-01", recurrence_period: "daily" }),
      "2020-01-01",
      "2030-01-01",
      NONE,
    );
    expect(out).toHaveLength(MAX_TASK_INSTANCES);
  });

  it("spends the cap on the requested range, not on walking up to it", () => {
    // A daily chore started years ago still has to reach today, or the digest
    // goes quiet on a day the agenda shows as busy.
    const out = expandTaskOccurrences(
      task({ due_date: "2020-01-01", recurrence_period: "daily" }),
      "2026-06-01",
      "2026-06-03",
      NONE,
    );
    expect(out.map((i) => i.effectiveDate)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
});

describe("isTaskDoneOn", () => {
  it("reads is_completed for a non-recurring task, whatever the date", () => {
    expect(isTaskDoneOn(task({ is_completed: true }), "2026-06-01", NONE)).toBe(true);
    expect(isTaskDoneOn(task({ is_completed: true }), "2026-09-09", NONE)).toBe(true);
    expect(isTaskDoneOn(task(), "2026-06-01", NONE)).toBe(false);
  });

  it("reads the shared occurrence row for a recurring task", () => {
    const daily = task({ recurrence_period: "daily" });
    const rows = byKey(occurrence({ occurrence_date: "2026-06-02" }));
    expect(isTaskDoneOn(daily, "2026-06-02", rows)).toBe(true);
    expect(isTaskDoneOn(daily, "2026-06-03", rows)).toBe(false);
  });

  it("resolves per assignee when completion_mode says so", () => {
    const chore = task({ recurrence_period: "daily", completion_mode: "per_assignee" });
    const rows = byKey(occurrence({ person_id: ANA }));
    expect(isTaskDoneOn(chore, "2026-06-01", rows, ANA)).toBe(true);
    expect(isTaskDoneOn(chore, "2026-06-01", rows, BOB)).toBe(false);
    // No person asked, and no whole-occurrence row to fall back on: one assignee's
    // copy is not the occurrence as a whole.
    expect(isTaskDoneOn(chore, "2026-06-01", rows)).toBe(false);
  });

  it("falls back to a shared tick in per_assignee mode when no person is asked", () => {
    // A task switched from 'shared' to 'per_assignee' mid-life keeps the ticks it
    // already collected on the whole-occurrence row.
    const chore = task({ recurrence_period: "daily", completion_mode: "per_assignee" });
    const rows = byKey(occurrence());
    expect(isTaskDoneOn(chore, "2026-06-01", rows)).toBe(true);
    // Asked as somebody, it is still that person's own row that answers.
    expect(isTaskDoneOn(chore, "2026-06-01", rows, ANA)).toBe(false);
  });

  it("ignores person_id entirely in shared mode", () => {
    const chore = task({ recurrence_period: "daily" });
    const rows = byKey(occurrence());
    expect(isTaskDoneOn(chore, "2026-06-01", rows, BOB)).toBe(true);
  });

  it("never counts a skipped or moved row as done", () => {
    const chore = task({ recurrence_period: "daily" });
    expect(isTaskDoneOn(chore, "2026-06-01", byKey(occurrence({ status: "skipped" })))).toBe(false);
    expect(
      isTaskDoneOn(
        chore,
        "2026-06-01",
        byKey(occurrence({ status: "moved", moved_to_date: "2026-06-02" })),
      ),
    ).toBe(false);
  });
});

describe("isTaskOverdue", () => {
  it("is true only for an unfinished, non-recurring, past-due task", () => {
    expect(isTaskOverdue(task({ due_date: "2026-05-31" }), "2026-06-01")).toBe(true);
    expect(isTaskOverdue(task({ due_date: "2026-06-01" }), "2026-06-01")).toBe(false);
    expect(isTaskOverdue(task({ due_date: "2026-06-02" }), "2026-06-01")).toBe(false);
    expect(isTaskOverdue(task({ due_date: "2026-05-31", is_completed: true }), "2026-06-01")).toBe(
      false,
    );
    expect(isTaskOverdue(task({ due_date: null }), "2026-06-01")).toBe(false);
  });

  it("never carries a repeating task over", () => {
    expect(
      isTaskOverdue(task({ due_date: "2026-05-01", recurrence_period: "daily" }), "2026-06-01"),
    ).toBe(false);
  });
});

describe("isMissedOccurrence", () => {
  const daily = task({ recurrence_period: "daily" });

  it("is true for a past instance nobody resolved", () => {
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-03", NONE);
    expect(out.map((i) => isMissedOccurrence(i, "2026-06-03"))).toEqual([true, true, false]);
  });

  it("is false once the instance is done or skipped", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-01", status: "done" }),
      occurrence({ occurrence_date: "2026-06-02", status: "skipped" }),
    );
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-03", rows);
    expect(out.map((i) => isMissedOccurrence(i, "2026-06-03"))).toEqual([false, false, false]);
  });

  it("judges the effective date, not the original one", () => {
    const rows = byKey(
      occurrence({ occurrence_date: "2026-06-01", status: "moved", moved_to_date: "2026-06-05" }),
    );
    const out = expandTaskOccurrences(daily, "2026-06-01", "2026-06-05", rows);
    const moved = out.filter((i) => i.occurrenceDate === "2026-06-01");
    expect(moved.map((i) => i.effectiveDate)).toEqual(["2026-06-05"]);
    expect(moved.map((i) => isMissedOccurrence(i, "2026-06-03"))).toEqual([false]);
  });
});
