import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useKidBirthdayEntries } from "@/components/kid/KidFamily";
import { filterKidAgendaItems } from "@/components/kid/kidAgendaModel";
import type { KidBirthdayVisibility } from "@/components/kid/useKidBirthdayVisibility";
import type { AgendaItem } from "@/hooks/useAgenda";
import type { Birthday, Event } from "@/types/database";
import type { ResolvedActivityBlock } from "@/utils/activity";

/**
 * Birthdays are the one thing in the kid shell with no owner of its own, so
 * "whose is it" cannot be derived - it is a row in `birthday_visibility` or it
 * is nothing. Under a kid session RLS narrows that table; under a PARENT
 * session (the preview) it does not narrow anything at all.
 *
 * These tests pin the in-code gate that makes both sessions agree. If they ever
 * go green with the filter removed, a parent previewing their child is being
 * shown birthdays the child cannot see, which is the exact failure the preview
 * exists to avoid.
 */

const TODAY = "2026-10-05";
const KID = "kid-1";

function birthday(id: string, name: string, birthDate = "1980-11-19"): Birthday {
  return {
    id,
    family_id: "fam-1",
    name,
    birth_date: birthDate,
    description: null,
  } as Birthday;
}

function birthdayItem(row: Birthday, date = TODAY): AgendaItem {
  return { kind: "birthday", date, sortKey: -1, birthday: row };
}

function activityItem(personId: string): AgendaItem {
  return {
    kind: "activity",
    date: TODAY,
    sortKey: 1020,
    block: {
      scheduleId: "s1",
      activityId: "a1",
      personId,
      date: TODAY,
      dayOfWeek: 0,
      startTime: "17:00",
      endTime: "18:00",
      weekPattern: "every",
      recurrenceIntervalWeeks: 1,
    } as ResolvedActivityBlock,
    person: undefined,
    activity: undefined,
    canceled: false,
  };
}

function eventItem(personIds: string[]): AgendaItem {
  return {
    kind: "event",
    date: TODAY,
    sortKey: 990,
    event: { id: "e1", name: "Predstava", date: TODAY } as Event,
    isAllDay: true,
    startTime: null,
    endTime: null,
    dayIndex: 1,
    totalDays: 1,
    personIds,
    canceled: false,
  };
}

function paymentItem(): AgendaItem {
  return {
    kind: "payment",
    date: TODAY,
    sortKey: 500,
    // Only the discriminant matters here - the kind filter drops it first.
    payment: { id: "p1" } as never,
    occurrenceDate: TODAY,
    effectiveDate: TODAY,
    personIds: [KID],
  };
}

function visibility(ids: string[], notes: Record<string, string> = {}): KidBirthdayVisibility {
  return {
    visibleIds: new Set(ids),
    notes: new Map(Object.entries(notes)),
    isLoading: false,
  };
}

describe("filterKidAgendaItems", () => {
  const mine = birthday("b-mine", "Deda Rade");
  const theirs = birthday("b-theirs", "Kolega sa posla");

  it("keeps only the birthdays this child was told about", () => {
    const items = [birthdayItem(mine), birthdayItem(theirs)];
    const kept = filterKidAgendaItems(items, new Set([KID]), new Set(["b-mine"]));
    expect(kept).toEqual([birthdayItem(mine)]);
  });

  it("hides every birthday when nothing was ticked, rather than falling open", () => {
    // The empty set is a real answer ("none"), never "no filter" - this is the
    // difference between a fail-closed gate and a decorative one.
    const items = [birthdayItem(mine), birthdayItem(theirs)];
    expect(filterKidAgendaItems(items, new Set([KID]), new Set())).toEqual([]);
  });

  it("still filters other kinds by person, and drops kinds a kid never sees", () => {
    const items = [activityItem(KID), activityItem("sibling-2"), eventItem(["sibling-2"])];
    const kept = filterKidAgendaItems(items, new Set([KID]), new Set());
    expect(kept).toEqual([activityItem(KID)]);
  });

  it("drops payments even when they are assigned to the child", () => {
    const kept = filterKidAgendaItems([paymentItem()], new Set([KID]), new Set());
    expect(kept).toEqual([]);
  });

  it("survives an empty person set without turning the birthday gate off", () => {
    // No child resolved yet: `filterAgendaItems` short-circuits when the whole
    // filter is inert, so the birthday pass has to hold the line on its own.
    const kept = filterKidAgendaItems([birthdayItem(theirs)], new Set(), new Set());
    expect(kept).toEqual([]);
  });
});

describe("useKidBirthdayEntries", () => {
  const rows = [
    birthday("b-1", "Deda Rade", "1952-11-19"),
    birthday("b-2", "Baba Mira", "1955-08-04"),
    birthday("b-3", "Teta Sanja", "1984-03-12"),
  ];

  it("shows only the visible birthdays out of everything the session can read", () => {
    const { result } = renderHook(() =>
      useKidBirthdayEntries(rows, visibility(["b-1"], { "b-1": "Pozovi dedu!" }), TODAY),
    );
    expect(result.current.map((entry) => entry.birthday.name)).toEqual(["Deda Rade"]);
    expect(result.current[0].note).toBe("Pozovi dedu!");
  });

  it("keeps a visible birthday that has no note - the note is not the gate", () => {
    // A `birthday_visibility` row may carry a NULL note, so the note map is a
    // strict subset of the visible set and can never stand in for it.
    const { result } = renderHook(() => useKidBirthdayEntries(rows, visibility(["b-2"]), TODAY));
    expect(result.current.map((entry) => entry.birthday.name)).toEqual(["Baba Mira"]);
    expect(result.current[0].note).toBeNull();
  });

  it("shows nothing when no birthday was ticked for this child", () => {
    const { result } = renderHook(() => useKidBirthdayEntries(rows, visibility([]), TODAY));
    expect(result.current).toEqual([]);
  });

  it("orders the visible ones by how soon they are, soonest first", () => {
    const { result } = renderHook(() =>
      useKidBirthdayEntries(rows, visibility(["b-1", "b-2", "b-3"]), TODAY),
    );
    const days = result.current.map((entry) => entry.days);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    expect(result.current).toHaveLength(3);
  });
});
