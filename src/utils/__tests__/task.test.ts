import { describe, expect, it } from "vitest";

import type { Task, TaskOccurrence } from "@/types/database";
import {
  expandTaskOccurrences,
  isFutureOccurrence,
  isHiddenBySkip,
  isMissedOccurrence,
  isRecurringTask,
  isTaskDoneOn,
  isTaskOverdue,
  lateOccurrences,
  taskOccurrenceKey,
  taskRecurrenceLabel,
} from "@/utils/task";

/**
 * `utils/task.ts` is the only implementation of two rules the whole app depends
 * on, so both are pinned here:
 *
 *   1. WHICH DATES a task series has. `useAgenda`, the calendars, the kid shell
 *      and (in Deno) the digest all project through it; if they disagree about
 *      the day a chore lands on, an override saved on one surface is invisible
 *      to the other - the bug `recurrenceParity.test.ts` exists to guard for
 *      payments.
 *   2. WHERE COMPLETION LIVES. `tasks.is_completed` for a non-recurring task, a
 *      `task_occurrences` row for a recurring one, and per assignee or not
 *      depending on `completion_mode`.
 *
 * Every weekday index below is the schema's 0 = Monday .. 6 = Sunday, never a JS
 * `getDay()`. 2026-08-10 is a Monday, which every weekly fixture leans on.
 */

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    list_id: null,
    family_id: "fam",
    owner_id: "user1",
    scope: "family",
    name: "Izneti smeće",
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
    sort_order: 0,
    created_by_id: "user1",
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
    family_id: "fam",
    occurrence_date: "2026-08-10",
    person_id: null,
    status: "done",
    moved_to_date: null,
    completed_at: "2026-08-10T09:00:00Z",
    completed_by_person_id: "p1",
    acted_by_person_id: null,
    acted_at: null,
    note: null,
    created_at: "2026-08-10T09:00:00Z",
    updated_at: "2026-08-10T09:00:00Z",
    ...overrides,
  };
}

/** The `{ byKey }` shape `useTaskOccurrences` hands the agenda. */
function byKey(...occurrences: TaskOccurrence[]): Map<string, TaskOccurrence[]> {
  const map = new Map<string, TaskOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = taskOccurrenceKey(occurrence.task_id, occurrence.occurrence_date);
    const rows = map.get(key);
    if (rows) rows.push(occurrence);
    else map.set(key, [occurrence]);
  }
  return map;
}

const NO_OCCURRENCES = new Map<string, TaskOccurrence[]>();

/** Series dates only - what most walk assertions care about. */
function seriesDates(task: Task, from: string, to: string): string[] {
  return expandTaskOccurrences(task, from, to, NO_OCCURRENCES).map((i) => i.occurrenceDate);
}

/* ------------------------------------------------------------------------- */
/* isRecurringTask / taskOccurrenceKey                                        */
/* ------------------------------------------------------------------------- */

describe("isRecurringTask", () => {
  it("treats null and one-time as not repeating", () => {
    expect(isRecurringTask(makeTask({ recurrence_period: null }))).toBe(false);
    expect(isRecurringTask(makeTask({ recurrence_period: "one-time" }))).toBe(false);
  });

  it("treats every real period as repeating", () => {
    expect(isRecurringTask(makeTask({ recurrence_period: "daily" }))).toBe(true);
    expect(isRecurringTask(makeTask({ recurrence_period: "weekly" }))).toBe(true);
    expect(isRecurringTask(makeTask({ recurrence_period: "monthly" }))).toBe(true);
  });
});

describe("taskOccurrenceKey", () => {
  it("is the `${taskId}|${occurrenceDate}` shape the hooks index by", () => {
    expect(taskOccurrenceKey("t1", "2026-08-10")).toBe("t1|2026-08-10");
  });
});

/* ------------------------------------------------------------------------- */
/* Non-recurring expansion                                                    */
/* ------------------------------------------------------------------------- */

describe("expandTaskOccurrences: non-recurring", () => {
  it("yields exactly one instance on its due date", () => {
    const task = makeTask({ due_date: "2026-08-12" });
    expect(expandTaskOccurrences(task, "2026-08-10", "2026-08-16", NO_OCCURRENCES)).toEqual([
      {
        occurrenceDate: "2026-08-12",
        effectiveDate: "2026-08-12",
        occurrence: undefined,
        isDone: false,
        isSkipped: false,
      },
    ]);
  });

  it("yields nothing for an undated task - a someday item is not on any day", () => {
    const task = makeTask({ due_date: null });
    expect(expandTaskOccurrences(task, "2026-08-01", "2026-08-31", NO_OCCURRENCES)).toEqual([]);
  });

  it("yields nothing outside the window, on either side", () => {
    // Before the window: the overdue block picks these up via isTaskOverdue, the
    // agenda window must not surface them on a day they are not due.
    expect(seriesDates(makeTask({ due_date: "2026-08-01" }), "2026-08-10", "2026-08-16")).toEqual(
      [],
    );
    expect(seriesDates(makeTask({ due_date: "2026-09-01" }), "2026-08-10", "2026-08-16")).toEqual(
      [],
    );
  });

  it("reads is_completed for isDone, the non-recurring home of completion", () => {
    const task = makeTask({ due_date: "2026-08-12", is_completed: true });
    const [instance] = expandTaskOccurrences(task, "2026-08-10", "2026-08-16", NO_OCCURRENCES);
    expect(instance.isDone).toBe(true);
  });

  it("treats an explicit one-time period the same as null", () => {
    const task = makeTask({ due_date: "2026-08-12", recurrence_period: "one-time" });
    expect(seriesDates(task, "2026-08-10", "2026-08-16")).toEqual(["2026-08-12"]);
  });
});

/* ------------------------------------------------------------------------- */
/* Daily walking                                                              */
/* ------------------------------------------------------------------------- */

describe("expandTaskOccurrences: daily", () => {
  it("interval 1 fires every day of the window", () => {
    const task = makeTask({ recurrence_period: "daily" });
    expect(seriesDates(task, "2026-08-10", "2026-08-14")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]);
  });

  it("interval 3 fires every third day, counted from the anchor", () => {
    const task = makeTask({ recurrence_period: "daily", recurrence_interval: 3 });
    expect(seriesDates(task, "2026-08-10", "2026-08-20")).toEqual([
      "2026-08-10",
      "2026-08-13",
      "2026-08-16",
      "2026-08-19",
    ]);
  });

  it("never reports a day before the series starts", () => {
    const task = makeTask({ recurrence_period: "daily", due_date: "2026-08-12" });
    expect(seriesDates(task, "2026-08-01", "2026-08-14")).toEqual([
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]);
  });

  it("crosses a month boundary", () => {
    const task = makeTask({ recurrence_period: "daily", due_date: "2026-08-30" });
    expect(seriesDates(task, "2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("still reaches a window years after the anchor", () => {
    // The regression this guards: the series' phase is set by its ANCHOR, and a
    // chore that has repeated daily since 2024 has ~950 dates before this month.
    // Stepping through them one at a time would exhaust the 366-instance guard on
    // the way and report nothing at all, so the walk jumps to `from` instead.
    const task = makeTask({ recurrence_period: "daily", due_date: "2024-01-01" });
    expect(seriesDates(task, "2026-08-10", "2026-08-12")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
  });

  it("keeps the interval phase intact when it skips ahead", () => {
    // Only anchor + 3k days fire. 2024-01-01 -> 2026-08-10 is 952 days and
    // 952 % 3 === 1, so the 9th is an occurrence and the 10th is not: the first
    // one inside the window is the 12th.
    const task = makeTask({
      recurrence_period: "daily",
      recurrence_interval: 3,
      due_date: "2024-01-01",
    });
    expect(seriesDates(task, "2026-08-10", "2026-08-15")).toEqual(["2026-08-12", "2026-08-15"]);
  });

  it("caps the walk at 366 instances", () => {
    const task = makeTask({ recurrence_period: "daily", due_date: "2026-01-01" });
    const dates = seriesDates(task, "2026-01-01", "2029-12-31");
    expect(dates).toHaveLength(366);
    expect(dates.at(-1)).toBe("2027-01-01");
  });
});

/* ------------------------------------------------------------------------- */
/* Weekly walking                                                             */
/* ------------------------------------------------------------------------- */

describe("expandTaskOccurrences: weekly without a weekday set", () => {
  it("repeats on the anchor's own weekday", () => {
    const task = makeTask({ recurrence_period: "weekly" });
    expect(seriesDates(task, "2026-08-10", "2026-09-01")).toEqual([
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
  });

  it("derives that weekday Monday-first, not from a raw getDay()", () => {
    // 2026-07-01 is a Wednesday, so the derived set is [2] (Monday-first), not
    // JS's 3. A raw getDay() would land the series on Thursdays.
    const task = makeTask({ recurrence_period: "weekly", due_date: "2026-07-01" });
    expect(seriesDates(task, "2026-07-01", "2026-07-20")).toEqual([
      "2026-07-01",
      "2026-07-08",
      "2026-07-15",
    ]);
  });

  it("interval 2 skips a week", () => {
    const task = makeTask({ recurrence_period: "weekly", recurrence_interval: 2 });
    expect(seriesDates(task, "2026-08-10", "2026-09-08")).toEqual([
      "2026-08-10",
      "2026-08-24",
      "2026-09-07",
    ]);
  });
});

describe("expandTaskOccurrences: weekly with a weekday set", () => {
  it("fires on every listed weekday, 0 = Monday", () => {
    const task = makeTask({ recurrence_period: "weekly", recurrence_weekdays: [0, 2, 4] });
    expect(seriesDates(task, "2026-08-10", "2026-08-21")).toEqual([
      "2026-08-10", // Mon
      "2026-08-12", // Wed
      "2026-08-14", // Fri
      "2026-08-17",
      "2026-08-19",
      "2026-08-21",
    ]);
  });

  it("reads 6 as Sunday - the Monday-first convention, not getDay()", () => {
    // The anchor is Monday 2026-08-10. Weekday 6 is the Sunday that closes that
    // week (08-16); under JS's getDay() numbering it would be Saturday 08-15.
    const task = makeTask({ recurrence_period: "weekly", recurrence_weekdays: [6] });
    expect(seriesDates(task, "2026-08-10", "2026-08-31")).toEqual([
      "2026-08-16",
      "2026-08-23",
      "2026-08-30",
    ]);
  });

  it("drops the days of the anchor's own week that fall before the anchor", () => {
    // Anchor is Wednesday 2026-07-01; the set says Monday. The Monday of that
    // week (06-29) is before the series starts, so the first fire is 07-06.
    const task = makeTask({
      recurrence_period: "weekly",
      due_date: "2026-07-01",
      recurrence_weekdays: [0],
    });
    expect(seriesDates(task, "2026-06-20", "2026-07-20")).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
    ]);
  });

  it("counts interval in whole weeks from the anchor's week", () => {
    const task = makeTask({
      recurrence_period: "weekly",
      recurrence_weekdays: [0, 2],
      recurrence_interval: 2,
    });
    expect(seriesDates(task, "2026-08-10", "2026-09-10")).toEqual([
      "2026-08-10",
      "2026-08-12",
      "2026-08-24",
      "2026-08-26",
      "2026-09-07",
      "2026-09-09",
    ]);
  });

  it("keeps the every-N-weeks phase when it skips ahead to a far window", () => {
    // 2024-01-01 and 2026-08-10 are both Mondays, 136 weeks apart - an even
    // number, so the window's week IS an active one for interval 2.
    const task = makeTask({
      recurrence_period: "weekly",
      due_date: "2024-01-01",
      recurrence_weekdays: [0, 2],
      recurrence_interval: 2,
    });
    expect(seriesDates(task, "2026-08-10", "2026-08-23")).toEqual(["2026-08-10", "2026-08-12"]);
    // The neighbouring week is the off week - shifting the window one week back
    // finds the previous active block instead.
    expect(seriesDates(task, "2026-08-17", "2026-08-23")).toEqual([]);
  });

  it("ignores garbage weekday values instead of inventing dates", () => {
    // The column is a bare SMALLINT[]; 7 and -1 are not weekdays, and a
    // duplicate must not fire twice.
    const task = makeTask({ recurrence_period: "weekly", recurrence_weekdays: [2, 7, -1, 2] });
    expect(seriesDates(task, "2026-08-10", "2026-08-20")).toEqual(["2026-08-12", "2026-08-19"]);
  });
});

/* ------------------------------------------------------------------------- */
/* Monthly walking                                                            */
/* ------------------------------------------------------------------------- */

describe("expandTaskOccurrences: monthly", () => {
  it("anchors on the day of month so the 31st does not drift", () => {
    // The bug this rules out (and that `addMonthAnchored` exists for): chaining
    // the step on its own clamped output gives 31, 28, 28, 28 ... forever.
    const task = makeTask({ recurrence_period: "monthly", due_date: "2026-01-31" });
    expect(seriesDates(task, "2026-01-01", "2026-06-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("interval 3 is quarterly, and off months are empty", () => {
    const task = makeTask({
      recurrence_period: "monthly",
      due_date: "2026-04-10",
      recurrence_interval: 3,
    });
    expect(seriesDates(task, "2026-07-01", "2026-07-31")).toEqual(["2026-07-10"]);
    expect(seriesDates(task, "2026-05-01", "2026-05-31")).toEqual([]);
  });

  it("recovers the anchor day even when it skips ahead by decades", () => {
    // 1990-05-10 to 2026-08 is 435 monthly steps - past the 366 guard if walked
    // one month at a time.
    const task = makeTask({ recurrence_period: "monthly", due_date: "1990-05-10" });
    expect(seriesDates(task, "2026-08-01", "2026-08-31")).toEqual(["2026-08-10"]);
  });
});

/* ------------------------------------------------------------------------- */
/* recurrence_until                                                           */
/* ------------------------------------------------------------------------- */

describe("recurrence_until", () => {
  it("is inclusive - a series date landing exactly on it still fires", () => {
    const task = makeTask({
      recurrence_period: "daily",
      recurrence_until: "2026-08-12",
    });
    expect(seriesDates(task, "2026-08-10", "2026-08-31")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
  });

  it("cuts the walk when it falls between two series dates", () => {
    const task = makeTask({
      recurrence_period: "weekly",
      recurrence_until: "2026-08-20",
    });
    expect(seriesDates(task, "2026-08-10", "2026-09-30")).toEqual(["2026-08-10", "2026-08-17"]);
  });

  it("empties a window that opens after the series ended", () => {
    const task = makeTask({ recurrence_period: "daily", recurrence_until: "2026-08-12" });
    expect(seriesDates(task, "2026-08-13", "2026-08-31")).toEqual([]);
  });

  it("never extends the window - `to` still wins when it is the earlier bound", () => {
    const task = makeTask({ recurrence_period: "daily", recurrence_until: "2026-12-31" });
    expect(seriesDates(task, "2026-08-10", "2026-08-11")).toEqual(["2026-08-10", "2026-08-11"]);
  });
});

/* ------------------------------------------------------------------------- */
/* Overrides: moved / skipped / done                                          */
/* ------------------------------------------------------------------------- */

describe("moved occurrences", () => {
  const task = makeTask({ recurrence_period: "daily" });

  it("surfaces at moved_to_date, keeping the series date it is keyed by", () => {
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-11",
        status: "moved",
        moved_to_date: "2026-08-13",
      }),
    );
    const moved = expandTaskOccurrences(task, "2026-08-10", "2026-08-14", map).find(
      (i) => i.occurrenceDate === "2026-08-11",
    );
    expect(moved?.effectiveDate).toBe("2026-08-13");
    // The occurrence row travels with the instance so the row can offer "vrati".
    expect(moved?.occurrence?.status).toBe("moved");
    // And nothing else claims the original day.
    const onOriginalDay = expandTaskOccurrences(task, "2026-08-11", "2026-08-11", map);
    expect(onOriginalDay).toEqual([]);
  });

  it("drops out of the window when it is moved past its end", () => {
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-11",
        status: "moved",
        moved_to_date: "2026-08-25",
      }),
    );
    expect(
      expandTaskOccurrences(task, "2026-08-10", "2026-08-14", map).map((i) => i.effectiveDate),
    ).toEqual(["2026-08-10", "2026-08-12", "2026-08-13", "2026-08-14"]);
  });

  it("is pulled INTO the window when it was moved forward from before it", () => {
    // The series date sits outside the window but the occurrence now lands inside
    // it, so no enumeration of the window reaches it: the row is a candidate
    // because it carries a `moved_to_date` in range, and its series date is then
    // phase-tested. Output stays ordered by SERIES date, so the moved one leads.
    const earlier = makeTask({ recurrence_period: "daily", due_date: "2026-07-01" });
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-05",
        status: "moved",
        moved_to_date: "2026-08-11",
      }),
    );
    const instances = expandTaskOccurrences(earlier, "2026-08-10", "2026-08-11", map);
    expect(instances.map((i) => [i.occurrenceDate, i.effectiveDate])).toEqual([
      ["2026-08-05", "2026-08-11"],
      ["2026-08-10", "2026-08-10"],
      ["2026-08-11", "2026-08-11"],
    ]);
  });

  it("comes in from ANY distance, not out of a fixed lookback window", () => {
    // Nine months back. There is no walk to reach the series date - which is the
    // point: the old 62-day lookback silently dropped this one.
    const old = makeTask({ recurrence_period: "daily", due_date: "2025-01-01" });
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2025-11-04",
        status: "moved",
        moved_to_date: "2026-08-11",
      }),
    );
    const instances = expandTaskOccurrences(old, "2026-08-10", "2026-08-11", map);
    expect(instances.map((i) => [i.occurrenceDate, i.effectiveDate])).toEqual([
      ["2025-11-04", "2026-08-11"],
      ["2026-08-10", "2026-08-10"],
      ["2026-08-11", "2026-08-11"],
    ]);
  });

  it("comes in from a series date AFTER the window too, dragged backwards", () => {
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-09-20",
        status: "moved",
        moved_to_date: "2026-08-12",
      }),
    );
    const instances = expandTaskOccurrences(task, "2026-08-10", "2026-08-12", map);
    expect(instances.map((i) => [i.occurrenceDate, i.effectiveDate])).toEqual([
      ["2026-08-10", "2026-08-10"],
      ["2026-08-11", "2026-08-11"],
      ["2026-08-12", "2026-08-12"],
      ["2026-09-20", "2026-08-12"],
    ]);
  });

  it("is not pulled in from past `recurrence_until` - that date is not the series'", () => {
    const bounded = makeTask({ recurrence_period: "daily", recurrence_until: "2026-08-12" });
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-20",
        status: "moved",
        moved_to_date: "2026-08-11",
      }),
    );
    expect(
      expandTaskOccurrences(bounded, "2026-08-10", "2026-08-12", map).map((i) => i.occurrenceDate),
    ).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("ignores a row whose series date the rule does not have", () => {
    // Left behind by an edit to the recurrence: the chore now fires every third
    // day from the 10th, so the 11th never was one of its dates. The O(1) phase
    // test is what rejects it - inventing the instance would put a chore on a day
    // the series does not have.
    const everyThird = makeTask({ recurrence_period: "daily", recurrence_interval: 3 });
    const aligned = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-13",
        status: "moved",
        moved_to_date: "2026-08-15",
      }),
    );
    const stale = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-11",
        status: "moved",
        moved_to_date: "2026-08-15",
      }),
    );
    expect(
      expandTaskOccurrences(everyThird, "2026-08-14", "2026-08-15", aligned).map(
        (i) => i.effectiveDate,
      ),
    ).toEqual(["2026-08-15"]);
    expect(expandTaskOccurrences(everyThird, "2026-08-14", "2026-08-15", stale)).toEqual([]);
  });

  it("phase-tests a monthly move on the ANCHORED day of the month", () => {
    // Anchored on the 31st, so the series' February date is the 28th. A row keyed
    // on 02-28 is genuine; one keyed on 02-27 belongs to no occurrence.
    const monthly = makeTask({ recurrence_period: "monthly", due_date: "2026-01-31" });
    const real = byKey(
      makeOccurrence({
        occurrence_date: "2026-02-28",
        status: "moved",
        moved_to_date: "2026-03-02",
      }),
    );
    const stale = byKey(
      makeOccurrence({
        occurrence_date: "2026-02-27",
        status: "moved",
        moved_to_date: "2026-03-02",
      }),
    );
    expect(
      expandTaskOccurrences(monthly, "2026-03-01", "2026-03-05", real).map((i) => [
        i.occurrenceDate,
        i.effectiveDate,
      ]),
    ).toEqual([["2026-02-28", "2026-03-02"]]);
    expect(expandTaskOccurrences(monthly, "2026-03-01", "2026-03-05", stale)).toEqual([]);
  });

  it("phase-tests a weekly move on its weekday AND its week block", () => {
    // Mon + Wed every second week from Monday 2026-08-10: 08-12 is the active
    // block's Wednesday, 08-19 is the off week's.
    const biweekly = makeTask({
      recurrence_period: "weekly",
      recurrence_weekdays: [0, 2],
      recurrence_interval: 2,
    });
    const active = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-12",
        status: "moved",
        moved_to_date: "2026-08-18",
      }),
    );
    const offWeek = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-19",
        status: "moved",
        moved_to_date: "2026-08-18",
      }),
    );
    expect(
      expandTaskOccurrences(biweekly, "2026-08-17", "2026-08-21", active).map(
        (i) => i.occurrenceDate,
      ),
    ).toEqual(["2026-08-12"]);
    expect(expandTaskOccurrences(biweekly, "2026-08-17", "2026-08-21", offWeek)).toEqual([]);
  });

  it("stays at its new date after somebody ticks it off there", () => {
    // There is one row per slot, so ticking a moved occurrence flips `status` to
    // 'done' and leaves `moved_to_date` alone. Placement is `moved_to_date`,
    // resolution is `status`: reading the first off the second would snap this
    // back to the 11th wearing the 13th's checkmark.
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-11",
        status: "done",
        moved_to_date: "2026-08-13",
      }),
    );
    const instance = expandTaskOccurrences(task, "2026-08-10", "2026-08-14", map).find(
      (i) => i.occurrenceDate === "2026-08-11",
    );
    expect(instance?.effectiveDate).toBe("2026-08-13");
    expect(instance?.isDone).toBe(true);
    // And the day it came from is still nobody's.
    expect(expandTaskOccurrences(task, "2026-08-11", "2026-08-11", map)).toEqual([]);
  });

  it("stays at its new date after being skipped there", () => {
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-11",
        status: "skipped",
        moved_to_date: "2026-08-13",
      }),
    );
    const instance = expandTaskOccurrences(task, "2026-08-10", "2026-08-14", map).find(
      (i) => i.occurrenceDate === "2026-08-11",
    );
    expect(instance?.effectiveDate).toBe("2026-08-13");
    expect(instance?.isSkipped).toBe(true);
    expect(instance?.isDone).toBe(false);
  });

  it("ignores a moved row with no target date - the CHECK forbids it, be total anyway", () => {
    const map = byKey(
      makeOccurrence({ occurrence_date: "2026-08-11", status: "moved", moved_to_date: null }),
    );
    const instance = expandTaskOccurrences(task, "2026-08-11", "2026-08-11", map)[0];
    expect(instance.effectiveDate).toBe("2026-08-11");
  });
});

describe("skipped occurrences", () => {
  it("are still returned, flagged - the agenda layer decides to drop them", () => {
    const task = makeTask({ recurrence_period: "daily" });
    const map = byKey(makeOccurrence({ occurrence_date: "2026-08-11", status: "skipped" }));
    const instances = expandTaskOccurrences(task, "2026-08-10", "2026-08-12", map);
    expect(instances.map((i) => i.occurrenceDate)).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
    const skipped = instances[1];
    expect(skipped.isSkipped).toBe(true);
    expect(skipped.isDone).toBe(false);
    expect(skipped.occurrence?.status).toBe("skipped");
  });
});

describe("done occurrences", () => {
  it("mark only their own instance done, and it stays in the list", () => {
    const task = makeTask({ recurrence_period: "daily" });
    const map = byKey(makeOccurrence({ occurrence_date: "2026-08-11", status: "done" }));
    const instances = expandTaskOccurrences(task, "2026-08-10", "2026-08-12", map);
    // A ticked row must not vanish from under the thumb.
    expect(instances).toHaveLength(3);
    expect(instances.map((i) => i.isDone)).toEqual([false, true, false]);
  });
});

/* ------------------------------------------------------------------------- */
/* isTaskDoneOn - the two homes of completion                                 */
/* ------------------------------------------------------------------------- */

describe("isTaskDoneOn: non-recurring", () => {
  it("reads is_completed and ignores the date", () => {
    const open = makeTask();
    const done = makeTask({ is_completed: true });
    expect(isTaskDoneOn(open, "2026-08-10", NO_OCCURRENCES)).toBe(false);
    expect(isTaskDoneOn(done, "2026-08-10", NO_OCCURRENCES)).toBe(true);
    expect(isTaskDoneOn(done, "2026-01-01", NO_OCCURRENCES)).toBe(true);
  });

  it("ignores occurrence rows - is_completed is the only truth for a one-off", () => {
    const task = makeTask();
    const map = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "done" }));
    expect(isTaskDoneOn(task, "2026-08-10", map)).toBe(false);
  });
});

describe("isTaskDoneOn: recurring, completion_mode shared", () => {
  const task = makeTask({ recurrence_period: "daily" });

  it("needs a whole-occurrence row (person_id IS NULL) with status done", () => {
    const map = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "done" }));
    expect(isTaskDoneOn(task, "2026-08-10", map)).toBe(true);
    // One tick speaks for everybody, so a person id changes nothing.
    expect(isTaskDoneOn(task, "2026-08-10", map, "p2")).toBe(true);
  });

  it("is false with no row at all - no row means unresolved", () => {
    expect(isTaskDoneOn(task, "2026-08-10", NO_OCCURRENCES)).toBe(false);
  });

  it("is false for a skipped or moved row - resolved is not finished", () => {
    const skipped = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "skipped" }));
    const moved = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-10",
        status: "moved",
        moved_to_date: "2026-08-11",
      }),
    );
    expect(isTaskDoneOn(task, "2026-08-10", skipped)).toBe(false);
    expect(isTaskDoneOn(task, "2026-08-10", moved)).toBe(false);
  });

  it("does not accept a per-person row as the shared answer", () => {
    const map = byKey(
      makeOccurrence({ occurrence_date: "2026-08-10", status: "done", person_id: "p1" }),
    );
    expect(isTaskDoneOn(task, "2026-08-10", map)).toBe(false);
    expect(isTaskDoneOn(task, "2026-08-10", map, "p1")).toBe(false);
  });

  it("keys on the SERIES date, not on where a move put the occurrence", () => {
    const map = byKey(
      makeOccurrence({ occurrence_date: "2026-08-10", status: "done" }),
      makeOccurrence({ id: "o2", occurrence_date: "2026-08-11", status: "done" }),
    );
    expect(isTaskDoneOn(task, "2026-08-10", map)).toBe(true);
    expect(isTaskDoneOn(task, "2026-08-12", map)).toBe(false);
  });
});

describe("isTaskDoneOn: recurring, completion_mode per_assignee", () => {
  const task = makeTask({ recurrence_period: "daily", completion_mode: "per_assignee" });
  const map = byKey(
    makeOccurrence({ occurrence_date: "2026-08-10", status: "done", person_id: "p1" }),
    makeOccurrence({
      id: "o2",
      occurrence_date: "2026-08-10",
      status: "done",
      person_id: "p2",
    }),
    makeOccurrence({ id: "o3", occurrence_date: "2026-08-11", status: "done", person_id: "p1" }),
  );

  it("resolves on the row matching the given person", () => {
    expect(isTaskDoneOn(task, "2026-08-10", map, "p1")).toBe(true);
    expect(isTaskDoneOn(task, "2026-08-10", map, "p2")).toBe(true);
    expect(isTaskDoneOn(task, "2026-08-11", map, "p1")).toBe(true);
    // p2 has not done the 11th yet, even though p1 has.
    expect(isTaskDoneOn(task, "2026-08-11", map, "p2")).toBe(false);
    expect(isTaskDoneOn(task, "2026-08-10", map, "p3")).toBe(false);
  });

  it("answers false without a person when only per-person rows exist", () => {
    // Nobody's copy speaks for the occurrence, so with no whole-occurrence row to
    // fall back on the question has no answer.
    expect(isTaskDoneOn(task, "2026-08-10", map)).toBe(false);
    expect(isTaskDoneOn(task, "2026-08-10", map, null)).toBe(false);
  });

  it("falls back to a shared tick when asked without a person", () => {
    // A task switched from 'shared' to 'per_assignee' mid-life keeps the ticks it
    // already collected on the whole-occurrence row; dropping them would un-finish
    // history the moment somebody changed the setting.
    const shared = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "done" }));
    expect(isTaskDoneOn(task, "2026-08-10", shared)).toBe(true);
    expect(isTaskDoneOn(task, "2026-08-10", shared, null)).toBe(true);
  });

  it("does not accept a whole-occurrence row as one person's answer", () => {
    const shared = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "done" }));
    expect(isTaskDoneOn(task, "2026-08-10", shared, "p1")).toBe(false);
  });

  it("leaves the expansion's whole-occurrence isDone false", () => {
    // Per-assignee completion has no single answer, so the row layer re-resolves
    // with the viewer's person id instead of trusting `instance.isDone`.
    const instance = expandTaskOccurrences(task, "2026-08-10", "2026-08-10", map)[0];
    expect(instance.isDone).toBe(false);
    expect(isTaskDoneOn(task, instance.occurrenceDate, map, "p1")).toBe(true);
  });

  it("leaves isDone false even where a shared tick would answer", () => {
    // The one place `instance.isDone` deliberately says less than `isTaskDoneOn`:
    // isDone is an occurrence-WIDE fact and per_assignee has none, so the row layer
    // must ask per person rather than trust the fallback.
    const shared = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "done" }));
    const instance = expandTaskOccurrences(task, "2026-08-10", "2026-08-10", shared)[0];
    expect(instance.isDone).toBe(false);
    expect(isTaskDoneOn(task, "2026-08-10", shared)).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */
/* Overdue and missed                                                         */
/* ------------------------------------------------------------------------- */

describe("isTaskOverdue", () => {
  const today = "2026-08-10";

  it("is true for an unfinished one-off whose day has passed", () => {
    expect(isTaskOverdue(makeTask({ due_date: "2026-08-09" }), today)).toBe(true);
    expect(isTaskOverdue(makeTask({ due_date: "2026-07-01" }), today)).toBe(true);
  });

  it("is false today and in the future - not late yet", () => {
    expect(isTaskOverdue(makeTask({ due_date: today }), today)).toBe(false);
    expect(isTaskOverdue(makeTask({ due_date: "2026-08-11" }), today)).toBe(false);
  });

  it("is false once it is completed", () => {
    expect(isTaskOverdue(makeTask({ due_date: "2026-08-09", is_completed: true }), today)).toBe(
      false,
    );
  });

  it("is false for an undated task - a someday item cannot be late", () => {
    expect(isTaskOverdue(makeTask({ due_date: null }), today)).toBe(false);
  });

  it("is false for a repeating task, whatever its anchor says", () => {
    // A series has no single deadline to have missed, so this row-level question
    // stays false for it. Its instances are late one at a time, which is
    // `lateOccurrences` below.
    const daily = makeTask({ recurrence_period: "daily", due_date: "2026-01-01" });
    const weekly = makeTask({ recurrence_period: "weekly", due_date: "2026-01-01" });
    expect(isTaskOverdue(daily, today)).toBe(false);
    expect(isTaskOverdue(weekly, today)).toBe(false);
  });
});

describe("isFutureOccurrence", () => {
  const today = "2026-08-14";
  const repeat = makeTask({ recurrence_period: "daily", due_date: "2026-08-10" });

  it("is true only past today, for a repeat", () => {
    expect(isFutureOccurrence(repeat, "2026-08-15", today)).toBe(true);
    expect(isFutureOccurrence(repeat, "2026-08-14", today)).toBe(false);
    expect(isFutureOccurrence(repeat, "2026-08-13", today)).toBe(false);
  });

  it("is false for a one-off, whose due date is a deadline and not an appointment", () => {
    // Paying a bill or buying the milk before it is due is normal; doing
    // tomorrow's dishes today is not.
    const oneOff = makeTask({ recurrence_period: "one-time", due_date: "2026-08-20" });
    expect(isFutureOccurrence(oneOff, "2026-08-20", today)).toBe(false);
    expect(isFutureOccurrence({ recurrence_period: null }, "2026-08-20", today)).toBe(false);
  });
});

describe("isHiddenBySkip", () => {
  // No `today` here on purpose: this rule is about who owns a skipped day, not
  // about when it falls.
  const chore = makeTask({
    recurrence_period: "daily",
    due_date: "2026-08-12",
    completion_mode: "per_assignee",
  });

  function instanceOn(date: string, map: Map<string, TaskOccurrence[]>) {
    const found = expandTaskOccurrences(chore, "2026-08-01", "2026-08-31", map).find(
      (i) => i.occurrenceDate === date,
    );
    if (!found) throw new Error(`no instance on ${date}`);
    return found;
  }

  const skippedOn = (date: string, ...rest: TaskOccurrence[]) =>
    byKey(makeOccurrence({ occurrence_date: date, status: "skipped" }), ...rest);

  it("leaves an unskipped instance alone, whoever is asking", () => {
    const instance = instanceOn("2026-08-13", NO_OCCURRENCES);
    expect(isHiddenBySkip(chore, instance, NO_OCCURRENCES, "p1")).toBe(false);
    expect(isHiddenBySkip(chore, instance, NO_OCCURRENCES, null)).toBe(false);
  });

  it("hides a skipped instance from somebody who had not done it", () => {
    const map = skippedOn("2026-08-13");
    expect(isHiddenBySkip(chore, instanceOn("2026-08-13", map), map, "p2")).toBe(true);
  });

  it("keeps it for somebody who had already finished their own part", () => {
    // The day was called off for the rest; their work is not undone by that, and
    // the skip confirmation promises exactly this.
    const map = skippedOn(
      "2026-08-13",
      makeOccurrence({
        id: "o2",
        occurrence_date: "2026-08-13",
        person_id: "p1",
        status: "done",
      }),
    );
    expect(isHiddenBySkip(chore, instanceOn("2026-08-13", map), map, "p1")).toBe(false);
    expect(isHiddenBySkip(chore, instanceOn("2026-08-13", map), map, "p2")).toBe(true);
  });

  it("hides it from a viewer with no identity at all", () => {
    const map = skippedOn("2026-08-13");
    expect(isHiddenBySkip(chore, instanceOn("2026-08-13", map), map, null)).toBe(true);
  });

  it("hides a skipped SHARED day from everybody", () => {
    // There is one answer under `shared` and the skip overwrote it, so nobody
    // has a finished part to keep. (A finished shared day cannot be skipped at
    // all - the action is withdrawn.)
    const shared = makeTask({ recurrence_period: "daily", due_date: "2026-08-12" });
    const map = byKey(makeOccurrence({ occurrence_date: "2026-08-13", status: "skipped" }));
    const instance = expandTaskOccurrences(shared, "2026-08-01", "2026-08-31", map).find(
      (i) => i.occurrenceDate === "2026-08-13",
    );
    expect(isHiddenBySkip(shared, instance as never, map, "p1")).toBe(true);
  });
});

describe("lateOccurrences", () => {
  const today = "2026-08-14";
  const daily = makeTask({ recurrence_period: "daily", due_date: "2026-08-11" });

  const dates = (instances: { effectiveDate: string }[]) => instances.map((i) => i.effectiveDate);

  it("returns every unresolved past instance, oldest first", () => {
    expect(dates(lateOccurrences(daily, today, NO_OCCURRENCES))).toEqual([
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
    ]);
  });

  it("never includes today or the future", () => {
    const late = lateOccurrences(daily, today, NO_OCCURRENCES);
    expect(late.every((instance) => instance.effectiveDate < today)).toBe(true);
  });

  it("drops the instances that were done or skipped", () => {
    const map = byKey(
      makeOccurrence({ occurrence_date: "2026-08-11", status: "done" }),
      makeOccurrence({ occurrence_date: "2026-08-12", status: "skipped" }),
    );
    expect(dates(lateOccurrences(daily, today, map))).toEqual(["2026-08-13"]);
  });

  it("is empty for a task that does not repeat", () => {
    const oneOff = makeTask({ recurrence_period: "one-time", due_date: "2026-08-01" });
    // That one is `isTaskOverdue`; counted by both, it would be told off twice.
    expect(lateOccurrences(oneOff, today, NO_OCCURRENCES)).toEqual([]);
  });

  it("judges a moved instance by where it landed", () => {
    const forward = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-11",
        status: "moved",
        moved_to_date: "2026-08-20",
      }),
    );
    // Moved out of the past: not late, it is deliberately in the future.
    expect(dates(lateOccurrences(daily, today, forward))).toEqual(["2026-08-12", "2026-08-13"]);

    const backward = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-13",
        status: "moved",
        moved_to_date: "2026-08-12",
      }),
    );
    // Two instances land on the 12th, and both are owed.
    expect(dates(lateOccurrences(daily, today, backward))).toEqual([
      "2026-08-11",
      "2026-08-12",
      "2026-08-12",
    ]);
  });

  it("stops at the lookback bound instead of walking the whole series", () => {
    const old = makeTask({ recurrence_period: "daily", due_date: "2024-01-01" });
    const late = lateOccurrences(old, today, NO_OCCURRENCES);
    expect(late).toHaveLength(30);
    expect(late[0].effectiveDate).toBe("2026-07-15");
  });

  it("respects an ended series", () => {
    const ended = makeTask({
      recurrence_period: "daily",
      due_date: "2026-08-11",
      recurrence_until: "2026-08-12",
    });
    expect(dates(lateOccurrences(ended, today, NO_OCCURRENCES))).toEqual([
      "2026-08-11",
      "2026-08-12",
    ]);
  });

  it("counts a per_assignee chore as owed until EVERY assignee has ticked", () => {
    // `instance.isDone` is always false for this mode - whole-occurrence
    // completion is not a fact it has - so without the per-person re-resolution
    // a chore all three finished would be reported late forever.
    const chore = makeTask({
      recurrence_period: "daily",
      due_date: "2026-08-13",
      completion_mode: "per_assignee",
    });
    const assignees = ["p1", "p2"];
    const oneDone = byKey(
      makeOccurrence({ occurrence_date: "2026-08-13", person_id: "p1", status: "done" }),
    );
    expect(dates(lateOccurrences(chore, today, oneDone, assignees))).toEqual(["2026-08-13"]);

    const bothDone = byKey(
      makeOccurrence({ occurrence_date: "2026-08-13", person_id: "p1", status: "done" }),
      makeOccurrence({ occurrence_date: "2026-08-13", person_id: "p2", status: "done" }),
    );
    expect(lateOccurrences(chore, today, bothDone, assignees)).toEqual([]);
  });
});

describe("isMissedOccurrence", () => {
  const today = "2026-08-12";
  const task = makeTask({ recurrence_period: "daily", due_date: "2026-08-10" });

  function instanceOn(date: string, map = NO_OCCURRENCES) {
    const found = expandTaskOccurrences(task, "2026-08-01", "2026-08-31", map).find(
      (i) => i.occurrenceDate === date,
    );
    if (!found) throw new Error(`no instance on ${date}`);
    return found;
  }

  it("is true for a past instance nobody resolved", () => {
    expect(isMissedOccurrence(instanceOn("2026-08-10"), today)).toBe(true);
    expect(isMissedOccurrence(instanceOn("2026-08-11"), today)).toBe(true);
  });

  it("is false today and in the future", () => {
    expect(isMissedOccurrence(instanceOn("2026-08-12"), today)).toBe(false);
    expect(isMissedOccurrence(instanceOn("2026-08-13"), today)).toBe(false);
  });

  it("is false once the instance is done or skipped", () => {
    const done = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "done" }));
    const skipped = byKey(makeOccurrence({ occurrence_date: "2026-08-10", status: "skipped" }));
    expect(isMissedOccurrence(instanceOn("2026-08-10", done), today)).toBe(false);
    expect(isMissedOccurrence(instanceOn("2026-08-10", skipped), today)).toBe(false);
  });

  it("judges a moved instance by where it landed, not by its series date", () => {
    const map = byKey(
      makeOccurrence({
        occurrence_date: "2026-08-10",
        status: "moved",
        moved_to_date: "2026-08-14",
      }),
    );
    // Series date is in the past, but the occurrence now sits in the future.
    expect(isMissedOccurrence(instanceOn("2026-08-10", map), today)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* taskRecurrenceLabel                                                        */
/* ------------------------------------------------------------------------- */

describe("taskRecurrenceLabel", () => {
  const label = (overrides: Partial<Task>) => taskRecurrenceLabel(makeTask(overrides));

  it("is null when the task does not repeat", () => {
    expect(label({ recurrence_period: null })).toBeNull();
    expect(label({ recurrence_period: "one-time" })).toBeNull();
  });

  it("daily follows Serbian paucal agreement", () => {
    expect(label({ recurrence_period: "daily" })).toBe("Svaki dan");
    expect(label({ recurrence_period: "daily", recurrence_interval: 2 })).toBe("Svaka 2 dana");
    expect(label({ recurrence_period: "daily", recurrence_interval: 4 })).toBe("Svaka 4 dana");
    expect(label({ recurrence_period: "daily", recurrence_interval: 5 })).toBe("Svakih 5 dana");
    expect(label({ recurrence_period: "daily", recurrence_interval: 10 })).toBe("Svakih 10 dana");
  });

  it("weekly without a weekday set matches the payments phrasing", () => {
    expect(label({ recurrence_period: "weekly" })).toBe("Nedeljno");
    expect(label({ recurrence_period: "weekly", recurrence_interval: 2 })).toBe("Svake 2 nedelje");
    expect(label({ recurrence_period: "weekly", recurrence_interval: 6 })).toBe("Svake 6 nedelje");
  });

  it("names the weekday sets that have a name", () => {
    expect(label({ recurrence_period: "weekly", recurrence_weekdays: [0, 1, 2, 3, 4] })).toBe(
      "Radnim danima",
    );
    expect(label({ recurrence_period: "weekly", recurrence_weekdays: [5, 6] })).toBe("Vikendom");
    expect(label({ recurrence_period: "weekly", recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      "Svaki dan",
    );
  });

  it("lists the other weekday sets, Monday-first", () => {
    expect(label({ recurrence_period: "weekly", recurrence_weekdays: [0, 2] })).toBe("Pon, Sre");
    // Order and duplicates come off the column as they are stored; the label
    // normalizes both.
    expect(label({ recurrence_period: "weekly", recurrence_weekdays: [6, 2, 6] })).toBe("Sre, Ned");
  });

  it("puts the weekday set behind the cadence when it repeats every N weeks", () => {
    expect(
      label({ recurrence_period: "weekly", recurrence_weekdays: [0, 2], recurrence_interval: 2 }),
    ).toBe("Svake 2 nedelje (Pon, Sre)");
    // A named set has no special phrasing once a cadence is in front of it.
    expect(
      label({
        recurrence_period: "weekly",
        recurrence_weekdays: [5, 6],
        recurrence_interval: 3,
      }),
    ).toBe("Svake 3 nedelje (Sub, Ned)");
  });

  it("monthly follows Serbian paucal agreement", () => {
    expect(label({ recurrence_period: "monthly" })).toBe("Mesečno");
    expect(label({ recurrence_period: "monthly", recurrence_interval: 3 })).toBe("Svaka 3 meseca");
    expect(label({ recurrence_period: "monthly", recurrence_interval: 6 })).toBe("Svakih 6 meseci");
  });

  it("appends the inclusive last day of a bounded series", () => {
    expect(label({ recurrence_period: "weekly", recurrence_until: "2026-12-31" })).toBe(
      "Nedeljno do 31.12.2026",
    );
    expect(
      label({
        recurrence_period: "weekly",
        recurrence_weekdays: [0, 1, 2, 3, 4],
        recurrence_until: "2026-09-01",
      }),
    ).toBe("Radnim danima do 01.09.2026");
  });

  it("degrades a nonsense interval to 1 instead of printing it", () => {
    expect(label({ recurrence_period: "daily", recurrence_interval: 0 })).toBe("Svaki dan");
    expect(label({ recurrence_period: "monthly", recurrence_interval: -3 })).toBe("Mesečno");
  });
});
