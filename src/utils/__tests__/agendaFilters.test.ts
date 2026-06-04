import { describe, expect, it } from "vitest";
import type { AgendaItem } from "@/hooks/useAgenda";
import {
  agendaFilterCount,
  agendaItemPersonIds,
  type AgendaFilter,
  filterAgendaItems,
  groupAgendaByDay,
  isAgendaFilterActive,
  matchesAgendaFilter,
} from "../agendaFilters";

/* ------------------------------------------------------------------------- */
/* Minimal AgendaItem fixtures — only the fields the filter reads matter, so  */
/* the rest is cast away rather than built out.                              */
/* ------------------------------------------------------------------------- */

function activityItem(personId: string, date = "2026-06-04"): AgendaItem {
  return {
    kind: "activity",
    date,
    sortKey: 600,
    block: { personId },
  } as unknown as AgendaItem;
}

function eventItem(personIds: string[], date = "2026-06-04"): AgendaItem {
  return { kind: "event", date, sortKey: 600, personIds } as unknown as AgendaItem;
}

function paymentItem(personIds: string[], date = "2026-06-04"): AgendaItem {
  return { kind: "payment", date, sortKey: 1443, personIds } as unknown as AgendaItem;
}

function birthdayItem(date = "2026-06-04"): AgendaItem {
  return { kind: "birthday", date, sortKey: 1442 } as unknown as AgendaItem;
}

function filter(kinds: AgendaItem["kind"][] = [], personIds: string[] = []): AgendaFilter {
  return { kinds: new Set(kinds), personIds: new Set(personIds) };
}

/* ------------------------------------------------------------------------- */

describe("agendaItemPersonIds", () => {
  it("reads the right field per kind; birthdays have none", () => {
    expect(agendaItemPersonIds(activityItem("ana"))).toEqual(["ana"]);
    expect(agendaItemPersonIds(eventItem(["ana", "bob"]))).toEqual(["ana", "bob"]);
    expect(agendaItemPersonIds(paymentItem(["bob"]))).toEqual(["bob"]);
    expect(agendaItemPersonIds(birthdayItem())).toEqual([]);
  });
});

describe("matchesAgendaFilter — type", () => {
  it("empty kinds passes everything", () => {
    expect(matchesAgendaFilter(eventItem([]), filter())).toBe(true);
  });

  it("keeps selected kinds, drops the rest", () => {
    const f = filter(["event", "payment"]);
    expect(matchesAgendaFilter(eventItem([]), f)).toBe(true);
    expect(matchesAgendaFilter(paymentItem([]), f)).toBe(true);
    expect(matchesAgendaFilter(activityItem("ana"), f)).toBe(false);
    expect(matchesAgendaFilter(birthdayItem(), f)).toBe(false);
  });
});

describe("matchesAgendaFilter — person", () => {
  it("empty people passes everything", () => {
    expect(matchesAgendaFilter(eventItem([]), filter())).toBe(true);
  });

  it("keeps items assigned to a selected person", () => {
    const f = filter([], ["ana"]);
    expect(matchesAgendaFilter(activityItem("ana"), f)).toBe(true);
    expect(matchesAgendaFilter(eventItem(["ana", "bob"]), f)).toBe(true);
    expect(matchesAgendaFilter(activityItem("bob"), f)).toBe(false);
    expect(matchesAgendaFilter(eventItem(["bob"]), f)).toBe(false);
  });

  it("hides unassigned events/payments under an active person filter", () => {
    const f = filter([], ["ana"]);
    expect(matchesAgendaFilter(eventItem([]), f)).toBe(false);
    expect(matchesAgendaFilter(paymentItem([]), f)).toBe(false);
  });

  it("always shows birthdays regardless of the person filter", () => {
    const f = filter([], ["ana"]);
    expect(matchesAgendaFilter(birthdayItem(), f)).toBe(true);
  });

  it("still applies the type filter to birthdays", () => {
    // Birthdays bypass the PERSON filter, not the TYPE filter.
    const f = filter(["event"], ["ana"]);
    expect(matchesAgendaFilter(birthdayItem(), f)).toBe(false);
  });
});

describe("matchesAgendaFilter — combined", () => {
  it("requires both facets to pass", () => {
    const f = filter(["event"], ["ana"]);
    expect(matchesAgendaFilter(eventItem(["ana"]), f)).toBe(true);
    expect(matchesAgendaFilter(eventItem(["bob"]), f)).toBe(false); // wrong person
    expect(matchesAgendaFilter(paymentItem(["ana"]), f)).toBe(false); // wrong kind
  });
});

describe("filterAgendaItems", () => {
  it("returns the same array reference when no filter is active", () => {
    const items = [eventItem([]), birthdayItem()];
    expect(filterAgendaItems(items, filter())).toBe(items);
  });

  it("filters by kind + person together", () => {
    const items = [
      activityItem("ana"),
      activityItem("bob"),
      eventItem(["ana"]),
      paymentItem(["ana"]),
      birthdayItem(),
    ];
    const out = filterAgendaItems(items, filter(["activity", "event"], ["ana"]));
    // activity(ana) ✓, event(ana) ✓; activity(bob) person✗; payment kind✗; birthday kind✗
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.kind)).toEqual(["activity", "event"]);
  });
});

describe("groupAgendaByDay", () => {
  it("buckets by date and lists days ascending", () => {
    const { byDay, days } = groupAgendaByDay([
      eventItem([], "2026-06-05"),
      eventItem([], "2026-06-04"),
      paymentItem([], "2026-06-04"),
    ]);
    expect(days).toEqual(["2026-06-04", "2026-06-05"]);
    expect(byDay.get("2026-06-04")).toHaveLength(2);
    expect(byDay.get("2026-06-05")).toHaveLength(1);
  });
});

describe("isAgendaFilterActive / agendaFilterCount", () => {
  it("reflects whether any facet is set", () => {
    expect(isAgendaFilterActive(filter())).toBe(false);
    expect(isAgendaFilterActive(filter(["event"]))).toBe(true);
    expect(isAgendaFilterActive(filter([], ["ana"]))).toBe(true);
  });

  it("counts kinds + people", () => {
    expect(agendaFilterCount(filter())).toBe(0);
    expect(agendaFilterCount(filter(["event", "payment"], ["ana"]))).toBe(3);
  });
});
