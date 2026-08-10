import { describe, expect, it } from "vitest";

import type { AgendaItem } from "@/hooks/useAgenda";
import type { Activity, Birthday, Event, Task } from "@/types/database";
import type { ResolvedActivityBlock } from "@/utils/activity";
import {
  KID_AGENDA_KINDS,
  ageOnOccurrence,
  kidCardModel,
  kidDetailModel,
  repeatLine,
  spanLine,
  taskRepeatLine,
  whenPrefix,
} from "@/components/kid/kidAgendaModel";

/**
 * The presentation model is where the shared agenda layer is translated into a
 * child's vocabulary, so these tests pin the translation rather than the
 * rendering: what the card says, what the sheet lists, and what a kid must
 * never be shown at all.
 */

const TODAY = "2026-10-05"; // a Monday

/** The rule's own times, i.e. "nothing moved" - the fixture's 17:00 - 18:00. */
const ORIGINAL_TIMES = { originalStartTime: "17:00", originalEndTime: "18:00" } as const;

function activityItem(
  overrides: Partial<ResolvedActivityBlock> = {},
  canceled = false,
): AgendaItem {
  const block = {
    scheduleId: "s1",
    activityId: "a1",
    personId: "kid-1",
    date: TODAY,
    dayOfWeek: 0,
    startTime: "17:00",
    endTime: "18:00",
    weekPattern: "every",
    recurrenceIntervalWeeks: 1,
    ...overrides,
  } as ResolvedActivityBlock;
  return {
    kind: "activity",
    date: block.date,
    sortKey: 1020,
    block,
    person: undefined,
    activity: {
      id: "a1",
      name: "Klavir",
      description: "muzička škola",
      notes: "Ponesi note",
    } as Activity,
    canceled,
  };
}

function eventItem(
  event: Partial<Event>,
  extra: Partial<Extract<AgendaItem, { kind: "event" }>> = {},
) {
  return {
    kind: "event",
    date: TODAY,
    sortKey: 990,
    event: {
      id: "e1",
      name: "Zubar - kontrola",
      description: "ideš sa mamom",
      notes: null,
      date: TODAY,
      end_date: null,
      ...event,
    } as Event,
    isAllDay: false,
    startTime: "16:30",
    endTime: null,
    dayIndex: 1,
    totalDays: 1,
    personIds: ["kid-1"],
    canceled: false,
    ...extra,
  } as AgendaItem;
}

function birthdayItem(date: string, birthDate: string): AgendaItem {
  return {
    kind: "birthday",
    date,
    // 1443 since tasks claimed 1442, right after the all-day bucket.
    sortKey: 1443,
    birthday: {
      id: "b1",
      name: "Baka Milica",
      description: null,
      birth_date: birthDate,
    } as Birthday,
  };
}

/**
 * A chore. `list_id` is set on purpose in the default fixture: a chore usually
 * lives in some list of the parent's, and no test below may ever see a trace of
 * it - that is the grown-up vocabulary.
 */
function taskItem(
  task: Partial<Task> = {},
  extra: Partial<Extract<AgendaItem, { kind: "task" }>> = {},
): AgendaItem {
  return {
    kind: "task",
    date: TODAY,
    // 1442 - the all-day bucket plus one, where an untimed chore sits.
    sortKey: 1442,
    task: {
      id: "t1",
      list_id: "kucni-poslovi",
      name: "Iznesi smeće",
      description: null,
      is_completed: false,
      due_date: TODAY,
      due_time: null,
      recurrence_period: null,
      recurrence_interval: 1,
      recurrence_weekdays: null,
      recurrence_until: null,
      completion_mode: "shared",
      ...task,
    } as Task,
    occurrenceDate: TODAY,
    dueTime: null,
    assigneeIds: ["kid-1"],
    isDone: false,
    missed: false,
    ...extra,
  } as AgendaItem;
}

describe("KID_AGENDA_KINDS", () => {
  it("is the allow-list of what a child may ever see", () => {
    expect([...KID_AGENDA_KINDS].sort()).toEqual(["activity", "birthday", "event", "task"]);
    expect(KID_AGENDA_KINDS.has("payment")).toBe(false);
    expect(KID_AGENDA_KINDS.has("external")).toBe(false);
  });
});

describe("kidCardModel", () => {
  it("shows an activity with its emoji, description and start time", () => {
    const model = kidCardModel(activityItem(), { todayISO: TODAY });
    expect(model).toMatchObject({
      emoji: "🎹",
      title: "Klavir",
      meta: "muzička škola",
      time: "17:00",
      tag: { tone: "activity", label: "aktivnost" },
    });
  });

  it("lets a reschedule note replace the description", () => {
    const item = activityItem({
      override: {
        id: "o1",
        action: "reschedule",
        originalStartTime: "17:00",
        originalEndTime: "18:00",
        note: "Danas u drugoj sali",
      },
    });
    expect(kidCardModel(item, { todayISO: TODAY }).meta).toBe("Danas u drugoj sali");
  });

  it("turns a multi-day event into a span chip and a span line", () => {
    const model = kidCardModel(
      eventItem(
        { name: "Ekskurzija - Tara", date: "2026-10-12", end_date: "2026-10-14" },
        { date: "2026-10-12", totalDays: 3, startTime: null, endTime: null, isAllDay: true },
      ),
      { todayISO: TODAY },
    );
    expect(model.emoji).toBe("🚌");
    expect(model.tag).toEqual({ tone: "span", label: "3 dana" });
    expect(model.meta).toBe("pon 12. okt - sre 14. okt");
    expect(model.time).toBeNull();
  });

  it("strikes a cancelled activity through and says so on the chip", () => {
    const model = kidCardModel(
      activityItem(
        { override: { id: "o1", action: "cancel", ...ORIGINAL_TIMES, note: null } },
        true,
      ),
      { todayISO: TODAY },
    );
    expect(model.canceled).toBe(true);
    expect(model.tag).toEqual({ tone: "canceled", label: "otkazano" });
    // It keeps its time: the row has to sit where the child expects it.
    expect(model.time).toBe("17:00");
    expect(model.moved).toBeNull();
  });

  it("keeps a parent's reason as the meta line of a cancelled row", () => {
    const model = kidCardModel(
      activityItem(
        { override: { id: "o1", action: "cancel", ...ORIGINAL_TIMES, note: "Trener je bolestan" } },
        true,
      ),
      { todayISO: TODAY },
    );
    expect(model.meta).toBe("Trener je bolestan");
  });

  it("marks a cancelled event without touching its title", () => {
    const model = kidCardModel(eventItem({}, { canceled: true }), { todayISO: TODAY });
    expect(model).toMatchObject({
      title: "Zubar - kontrola",
      canceled: true,
      tag: { tone: "canceled", label: "otkazano" },
    });
  });

  it("tells a child where a moved occurrence came from", () => {
    const model = kidCardModel(
      activityItem({
        startTime: "20:00",
        endTime: "21:30",
        override: {
          id: "o1",
          action: "reschedule",
          originalStartTime: "18:00",
          originalEndTime: "19:30",
          note: null,
        },
      }),
      { todayISO: TODAY },
    );
    expect(model.moved).toBe("pomereno sa 18:00");
    expect(model.time).toBe("20:00");
    expect(model.canceled).toBe(false);
  });

  it("says the DAY when the occurrence moved off another one", () => {
    const model = kidCardModel(
      activityItem({
        date: "2026-10-08",
        override: {
          id: "o1",
          action: "reschedule",
          originalStartTime: "18:00:00",
          originalEndTime: "19:30:00",
          note: null,
          movedFrom: "2026-10-07", // a Wednesday
        },
      }),
      { todayISO: TODAY },
    );
    expect(model.moved).toBe("pomereno sa srede, 18:00");
  });

  it("says nothing when a reschedule left the time alone", () => {
    const model = kidCardModel(
      activityItem({ override: { id: "o1", action: "reschedule", ...ORIGINAL_TIMES, note: null } }),
      { todayISO: TODAY },
    );
    expect(model.moved).toBeNull();
  });

  it("shows a chore with its own glyph, its repeat and nothing about its list", () => {
    const model = kidCardModel(taskItem({ recurrence_period: "daily", recurrence_interval: 1 }), {
      todayISO: TODAY,
    });
    expect(model).toMatchObject({
      emoji: "🗑️",
      title: "Iznesi smeće",
      meta: "Svaki dan",
      time: null,
      tag: { tone: "task", label: "zadatak" },
      done: false,
      canceled: false,
    });
    // The list it lives in is a grown-up's filing, never a line on a kid card.
    expect(JSON.stringify(model)).not.toContain("kucni-poslovi");
  });

  it("falls back to a parent's note when a chore does not repeat", () => {
    const model = kidCardModel(taskItem({ description: "kesa je ispod sudopere" }), {
      todayISO: TODAY,
    });
    expect(model.meta).toBe("kesa je ispod sudopere");
  });

  it("reads a ticked chore as done - struck, chipped, and still on the screen", () => {
    const model = kidCardModel(taskItem({}, { isDone: true }), { todayISO: TODAY });
    expect(model.done).toBe(true);
    expect(model.tag).toEqual({ tone: "done", label: "urađeno" });
    // Done is NOT cancelled: a finished chore is the child's own win, and the
    // card must not sink into the page the way a cancellation does.
    expect(model.canceled).toBe(false);
  });

  it("asks the hook, not the item, whether THIS child ticked a shared chore off", () => {
    // completion_mode 'per_assignee' gives one answer per assignee, so the
    // item's whole-occurrence `isDone` is structurally the wrong one.
    const item = taskItem(
      { completion_mode: "per_assignee", recurrence_period: "daily" },
      { isDone: false },
    );
    expect(kidCardModel(item, { todayISO: TODAY, taskDone: () => true }).done).toBe(true);
    // No answer from the hook falls back to the item, so the model stays total.
    expect(kidCardModel(item, { todayISO: TODAY, taskDone: () => undefined }).done).toBe(false);
  });

  it("puts a chore's clock on the right when it has one", () => {
    const model = kidCardModel(taskItem({ due_time: "18:00:00" }, { dueTime: "18:00" }), {
      todayISO: TODAY,
    });
    expect(model.time).toBe("18:00");
  });

  it("says a missed repeat plainly, without telling the child off", () => {
    const model = kidCardModel(taskItem({ recurrence_period: "daily" }, { missed: true }), {
      todayISO: TODAY,
    });
    expect(model.tag).toEqual({ tone: "canceled", label: "propušteno" });
  });

  it("gives a birthday an age in the title and a countdown as its chip", () => {
    const model = kidCardModel(birthdayItem("2026-10-14", "1958-10-14"), { todayISO: TODAY });
    expect(model.title).toBe("Baka Milica puni 68");
    expect(model.tag).toEqual({ tone: "birthday", label: "za 9 dana" });
    expect(model.meta).toBe("sreda, 14. okt");
  });
});

describe("kidDetailModel", () => {
  it("lists an activity's time, notes and recurrence", () => {
    const detail = kidDetailModel(activityItem(), { todayISO: TODAY });
    expect(detail.title).toBe("Klavir");
    expect(detail.rows).toEqual([
      { icon: "🕐", text: "Danas u 17:00 - 18:00" },
      { icon: "📝", text: "muzička škola" },
      { icon: "🎒", text: "Ponesi note" },
      { icon: "🔁", text: "Svakog ponedeljka" },
    ]);
  });

  it("puts a countdown on anything more than a day away", () => {
    const detail = kidDetailModel(
      eventItem({ date: "2026-10-10" }, { date: "2026-10-10", startTime: "12:00" }),
      { todayISO: TODAY },
    );
    expect(detail.rows).toContainEqual({ icon: "⏳", text: "Za 5 dana" });
  });

  it("leads a cancelled activity with the news and puts its slot in the past", () => {
    const detail = kidDetailModel(
      activityItem(
        { override: { id: "o1", action: "cancel", ...ORIGINAL_TIMES, note: null } },
        true,
      ),
      { todayISO: TODAY },
    );
    expect(detail.rows[0]).toEqual({ icon: "❌", text: "Otkazano - ovaj put ne ideš" });
    expect(detail.rows[1]).toEqual({ icon: "🕐", text: "Bilo je u planu: danas u 17:00 - 18:00" });
    // The series is still on, and that is the reassurance a child needs.
    expect(detail.rows).toContainEqual({ icon: "🔁", text: "Svakog ponedeljka" });
  });

  it("tells a cancelled event apart and drops its countdown", () => {
    const detail = kidDetailModel(
      eventItem({ date: "2026-10-10" }, { date: "2026-10-10", startTime: "12:00", canceled: true }),
      { todayISO: TODAY },
    );
    expect(detail.rows[0]).toEqual({ icon: "❌", text: "Otkazano - neće biti" });
    expect(detail.rows).toContainEqual({
      icon: "🕐",
      text: "Bilo je u planu: subota, 10. oktobar u 12:00",
    });
    expect(detail.rows.some((row) => row.icon === "⏳")).toBe(false);
  });

  it("puts the move on its own row in the sheet", () => {
    const detail = kidDetailModel(
      activityItem({
        startTime: "20:00",
        endTime: "21:30",
        override: {
          id: "o1",
          action: "reschedule",
          originalStartTime: "18:00",
          originalEndTime: "19:30",
          note: null,
        },
      }),
      { todayISO: TODAY },
    );
    expect(detail.rows[0]).toEqual({ icon: "🕐", text: "Danas u 20:00 - 21:30" });
    expect(detail.rows[1]).toEqual({ icon: "↪️", text: "Pomereno sa 18:00" });
  });

  it("tells a child when a chore is for and how often it comes back", () => {
    const detail = kidDetailModel(
      taskItem({
        recurrence_period: "weekly",
        recurrence_weekdays: [0, 2],
        description: "kesa je ispod sudopere",
      }),
      { todayISO: TODAY },
    );
    expect(detail.title).toBe("Iznesi smeće");
    expect(detail.rows).toEqual([
      { icon: "📅", text: "Danas, kad stigneš" },
      { icon: "🔁", text: "Ponedeljkom i sredom" },
      { icon: "📝", text: "kesa je ispod sudopere" },
    ]);
  });

  it("leads a finished chore with the good news and drops the countdown", () => {
    const detail = kidDetailModel(
      taskItem({ due_date: "2026-10-09" }, { date: "2026-10-09", isDone: true }),
      { todayISO: TODAY },
    );
    expect(detail.rows[0]).toEqual({ icon: "✅", text: "Završeno!" });
    // No "kad stigneš" on something already done, and nothing to count down to.
    expect(detail.rows[1]).toEqual({ icon: "📅", text: "Petak, 9. oktobar" });
    expect(detail.rows.some((row) => row.icon === "⏳")).toBe(false);
  });

  it("counts down to a chore that is still days away", () => {
    const detail = kidDetailModel(
      taskItem({ due_time: "07:30:00" }, { date: "2026-10-09", dueTime: "07:30" }),
      { todayISO: TODAY },
    );
    expect(detail.rows[0]).toEqual({ icon: "🕐", text: "Petak, 9. oktobar u 07:30" });
    expect(detail.rows).toContainEqual({ icon: "⏳", text: "Za 4 dana" });
  });

  it("describes a birthday with date, age and countdown", () => {
    const detail = kidDetailModel(birthdayItem("2026-10-14", "1958-10-14"), { todayISO: TODAY });
    expect(detail.rows).toEqual([
      { icon: "📅", text: "Sreda, 14. oktobar" },
      { icon: "🎂", text: "Puni 68 godina" },
      { icon: "⏳", text: "Za 9 dana" },
    ]);
  });
});

describe("helpers", () => {
  it("names the near days and dates the far ones", () => {
    expect(whenPrefix("2026-10-05", TODAY)).toBe("Danas");
    expect(whenPrefix("2026-10-06", TODAY)).toBe("Sutra");
    expect(whenPrefix("2026-10-07", TODAY)).toBe("Prekosutra");
    expect(whenPrefix("2026-10-14", TODAY)).toBe("Sreda, 14. oktobar");
  });

  it("uses the right Serbian case for every weekday", () => {
    expect(repeatLine(0, 1)).toBe("Svakog ponedeljka");
    expect(repeatLine(2, 1)).toBe("Svake srede");
    expect(repeatLine(6, 1)).toBe("Svake nedelje");
    expect(repeatLine(2, 2)).toBe("Svake druge nedelje, sredom");
    expect(repeatLine(4, 3)).toBe("Na svake 3 nedelje, petkom");
    expect(repeatLine(4, 6)).toBe("Na svakih 6 nedelja, petkom");
  });

  it("says a chore's repeat the way a child would", () => {
    const repeat = (task: Partial<Task>): string | null =>
      taskRepeatLine({
        due_date: TODAY, // a Monday
        recurrence_period: null,
        recurrence_interval: 1,
        recurrence_weekdays: null,
        ...task,
      } as Task);

    expect(repeat({ recurrence_period: "daily" })).toBe("Svaki dan");
    expect(repeat({ recurrence_period: "daily", recurrence_interval: 2 })).toBe("Svaki drugi dan");
    expect(repeat({ recurrence_period: "daily", recurrence_interval: 3 })).toBe("Na svaka 3 dana");
    expect(repeat({ recurrence_period: "daily", recurrence_interval: 10 })).toBe(
      "Na svakih 10 dana",
    );
    // No weekday set means "the day it started on", read off due_date.
    expect(repeat({ recurrence_period: "weekly" })).toBe("Svakog ponedeljka");
    expect(repeat({ recurrence_period: "weekly", recurrence_weekdays: [2] })).toBe("Svake srede");
    expect(repeat({ recurrence_period: "weekly", recurrence_weekdays: [0, 2] })).toBe(
      "Ponedeljkom i sredom",
    );
    expect(repeat({ recurrence_period: "weekly", recurrence_weekdays: [0, 2, 4] })).toBe(
      "Ponedeljkom, sredom i petkom",
    );
    expect(repeat({ recurrence_period: "weekly", recurrence_weekdays: [0, 1, 2, 3, 4] })).toBe(
      "Radnim danima",
    );
    expect(repeat({ recurrence_period: "weekly", recurrence_weekdays: [5, 6] })).toBe("Vikendom");
    expect(
      repeat({ recurrence_period: "weekly", recurrence_weekdays: [0, 2], recurrence_interval: 2 }),
    ).toBe("Svake druge nedelje, ponedeljkom i sredom");
    expect(repeat({ recurrence_period: "monthly" })).toBe("Jednom u mesecu");
    expect(repeat({ recurrence_period: "monthly", recurrence_interval: 3 })).toBe(
      "Na svaka 3 meseca",
    );
    expect(repeat({ recurrence_period: "one-time" })).toBeNull();
    expect(repeat({})).toBeNull();
  });

  it("keeps the end date out of it - that is a grown-up's business", () => {
    expect(
      taskRepeatLine({
        due_date: TODAY,
        recurrence_period: "daily",
        recurrence_interval: 1,
        recurrence_weekdays: null,
        recurrence_until: "2026-12-31",
      } as Task),
    ).toBe("Svaki dan");
  });

  it("survives a nonsense weekday array from the database", () => {
    // The column is a bare SMALLINT[], so a hand-written row can carry a 7 or a
    // duplicate. Sorted, deduped and clamped, or the label reads "svakog dana".
    expect(
      taskRepeatLine({
        due_date: TODAY,
        recurrence_period: "weekly",
        recurrence_interval: 1,
        recurrence_weekdays: [2, 0, 2, 9],
      } as Task),
    ).toBe("Ponedeljkom i sredom");
  });

  it("reads an age off the occurrence year, not off today", () => {
    expect(ageOnOccurrence("1958-10-14", "2026-10-14")).toBe(68);
    expect(ageOnOccurrence("2026-10-14", "2026-10-14")).toBeNull();
  });

  it("formats a span across two dates", () => {
    expect(spanLine("2026-10-12", "2026-10-14")).toBe("pon 12. okt - sre 14. okt");
  });
});
