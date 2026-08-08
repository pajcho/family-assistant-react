import { describe, expect, it } from "vitest";

import type { AgendaItem } from "@/hooks/useAgenda";
import type { Activity, Birthday, Event } from "@/types/database";
import type { ResolvedActivityBlock } from "@/utils/activity";
import {
  KID_AGENDA_KINDS,
  ageOnOccurrence,
  kidCardModel,
  kidDetailModel,
  repeatLine,
  spanLine,
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
    sortKey: 1442,
    birthday: {
      id: "b1",
      name: "Baka Milica",
      description: null,
      birth_date: birthDate,
    } as Birthday,
  };
}

describe("KID_AGENDA_KINDS", () => {
  it("is the allow-list of what a child may ever see", () => {
    expect([...KID_AGENDA_KINDS].sort()).toEqual(["activity", "birthday", "event"]);
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

  it("reads an age off the occurrence year, not off today", () => {
    expect(ageOnOccurrence("1958-10-14", "2026-10-14")).toBe(68);
    expect(ageOnOccurrence("2026-10-14", "2026-10-14")).toBeNull();
  });

  it("formats a span across two dates", () => {
    expect(spanLine("2026-10-12", "2026-10-14")).toBe("pon 12. okt - sre 14. okt");
  });
});
