import { describe, expect, it } from "vitest";

import { activityScheduleLabel } from "@/utils/activity";
import {
  candidateDetail,
  rankLinkSuggestions,
  suggestionDetail,
  type SuggestionCandidate,
} from "@/utils/linkSuggestions";

/**
 * The rules that decide what "Poveži sa" offers. The regression that started
 * this: typing "Frizer feniranje" surfaced a THREE-MONTH-OLD "Sonja frizer"
 * event as the single suggestion, with no date shown - one tap and an August
 * payment hung off a May event. Name alone must no longer win on its own, and
 * every suggestion must carry its date.
 */

const trip: SuggestionCandidate = {
  kind: "event",
  id: "trip",
  name: "Letovanje - Grčka",
  date: "2026-08-05",
  endDate: "2026-08-15",
  startTime: "06:00",
  endTime: "20:00",
};

const oldHair: SuggestionCandidate = {
  kind: "event",
  id: "old-hair",
  name: "Sonja frizer",
  date: "2026-05-14",
  endDate: null,
  startTime: "10:00",
  endTime: "11:30",
};

const english: SuggestionCandidate = {
  kind: "activity",
  id: "english",
  name: "Engleski",
  daySlots: [{ startTime: "17:00", endTime: "18:00" }],
};

/** Same activity on a day it does NOT run - the caller resolves no termini. */
const englishOffDay: SuggestionCandidate = { ...english, daySlots: [] };

const swimming: SuggestionCandidate = {
  kind: "activity",
  id: "swim",
  name: "Plivanje",
  daySlots: [{ startTime: "09:00", endTime: "10:00" }],
};

const concert: SuggestionCandidate = {
  kind: "event",
  id: "concert",
  name: "Koncert",
  date: "2026-08-12",
  endDate: null,
  startTime: "20:00",
  endTime: null,
};

const birthday: SuggestionCandidate = {
  kind: "birthday",
  id: "bday",
  name: "Vanda",
  date: "2026-08-11",
};

describe("rankLinkSuggestions", () => {
  it("suggests the multi-day event that is ongoing on the entry's date", () => {
    const [top] = rankLinkSuggestions([oldHair, trip], { date: "2026-08-08" });
    expect(top.candidate.id).toBe("trip");
    expect(top.reason).toBe("ongoing");
    expect(suggestionDetail(top)).toBe("u toku · 05.08. - 15.08.2026");
  });

  it("puts a receipt's clock time on the termin it falls inside", () => {
    const out = rankLinkSuggestions([swimming, english], {
      date: "2026-08-10",
      time: "18:12", // 12 min after Engleski ends - inside the grace window
    });
    expect(out[0].candidate.id).toBe("english");
    expect(out[0].reason).toBe("time");
    expect(suggestionDetail(out[0])).toBe("u to vreme · 17:00 - 18:00");
    // Plivanje still ran that day, so it stays - just below.
    expect(out[1]).toMatchObject({ candidate: { id: "swim" }, reason: "sameDay" });
    expect(suggestionDetail(out[1])).toBe("termin tog dana · 09:00 - 10:00");
  });

  it("does not fire the time signal outside the grace window", () => {
    const out = rankLinkSuggestions([english], { date: "2026-08-10", time: "21:30" });
    expect(out[0].reason).toBe("sameDay");
  });

  it("ignores an activity with no termin on that date", () => {
    expect(rankLinkSuggestions([englishOffDay], { date: "2026-08-10" })).toEqual([]);
  });

  it("keeps the name match but ranks a stale one below anything dated", () => {
    // Mid-typing "Frizer feniranje": at "Frizer" the old May event matches by
    // name, which is exactly how it got linked. It still shows - but second,
    // and now it says May out loud instead of showing a bare name.
    const out = rankLinkSuggestions([oldHair, trip], { name: "Frizer", date: "2026-08-08" });
    expect(out.map((s) => s.candidate.id)).toEqual(["trip", "old-hair"]);
    expect(suggestionDetail(out[1])).toBe("14.05.2026 · 10:00 - 11:30");
  });

  it("stops matching the stale event once the full name is typed", () => {
    // Neither string contains the other any more - the accidental link needed
    // that half-typed moment to exist at all.
    const out = rankLinkSuggestions([oldHair], { name: "Frizer feniranje", date: "2026-08-08" });
    expect(out).toEqual([]);
  });

  it("adds up signals so a name+day match beats a day-only one", () => {
    const out = rankLinkSuggestions([trip, concert], {
      name: "Koncert - karte",
      date: "2026-08-12",
    });
    expect(out[0].candidate.id).toBe("concert");
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it("offers events a few days out - deposits are paid before the trip", () => {
    const [top] = rankLinkSuggestions([trip], { date: "2026-08-02" });
    expect(top.reason).toBe("nearDay");
    expect(suggestionDetail(top)).toBe("za 3 dana · 05.08. - 15.08.2026");
  });

  it("drops events past the near-day window entirely", () => {
    expect(rankLinkSuggestions([concert], { date: "2026-07-01" })).toEqual([]);
  });

  it("reads 'sutra' / 'juče' instead of '1 dan'", () => {
    expect(suggestionDetail(rankLinkSuggestions([concert], { date: "2026-08-11" })[0])).toBe(
      "sutra · 12.08.2026",
    );
    expect(suggestionDetail(rankLinkSuggestions([concert], { date: "2026-08-13" })[0])).toBe(
      "juče · 12.08.2026",
    );
  });

  it("suggests a birthday around its date (poklon)", () => {
    const [top] = rankLinkSuggestions([birthday], { date: "2026-08-09" });
    expect(top).toMatchObject({ reason: "nearDay", dayDelta: 2 });
    expect(suggestionDetail(top)).toBe("za 2 dana · 11.08.2026");
  });

  it("needs 3 characters before a typed name matches anything", () => {
    expect(rankLinkSuggestions([oldHair], { name: "fr" })).toEqual([]);
    expect(rankLinkSuggestions([oldHair], { name: "fri" })).toHaveLength(1);
  });

  it("returns nothing without any context at all", () => {
    expect(rankLinkSuggestions([trip, english, birthday], {})).toEqual([]);
  });

  it("caps the list and orders ties by closeness, then name", () => {
    const out = rankLinkSuggestions([concert, birthday, trip, oldHair], { date: "2026-08-10" }, 2);
    expect(out).toHaveLength(2);
    expect(out[0].candidate.id).toBe("trip"); // ongoing outranks the near ones
    expect(out[1].candidate.id).toBe("bday"); // 1 day out beats the concert's 2
  });
});

describe("candidateDetail", () => {
  it("spells out the date and times for a picker row", () => {
    expect(candidateDetail(concert)).toBe("12.08.2026 · 20:00");
    expect(candidateDetail(birthday)).toBe("11.08.2026");
  });

  it("does not repeat the span for a multi-day event", () => {
    // The multi-day time range already names both edge dates, so prefixing
    // "05.08. - 15.08.2026" again only truncated the row.
    expect(candidateDetail(trip)).toBe("05.08. 06:00 - 15.08. 20:00");
    expect(candidateDetail({ ...trip, startTime: null, endTime: null })).toBe(
      "05.08. - 15.08.2026",
    );
  });

  it("omits a redundant 'Ceo dan' when the event has no times", () => {
    expect(candidateDetail({ ...concert, startTime: null, endTime: null })).toBe("12.08.2026");
  });

  it("shows an activity's weekly shape, falling back to a plain label", () => {
    expect(candidateDetail({ ...english, scheduleLabel: "Pon, Sre · 17:00 - 18:00" })).toBe(
      "Pon, Sre · 17:00 - 18:00",
    );
    expect(candidateDetail(english)).toBe("Aktivnost");
  });
});

describe("activityScheduleLabel", () => {
  const rule = (day: number, start: string, end: string) => ({
    day_of_week: day,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
  });

  it("collapses days that share one time range", () => {
    expect(activityScheduleLabel([rule(0, "17:00", "18:00"), rule(2, "17:00", "18:00")])).toBe(
      "Pon, Sre · 17:00 - 18:00",
    );
  });

  it("lists day+start pairs when the times differ", () => {
    expect(activityScheduleLabel([rule(2, "18:30", "19:30"), rule(0, "17:00", "18:00")])).toBe(
      "Pon 17:00 · Sre 18:30",
    );
  });

  it("truncates past the cap and returns null with no rules", () => {
    const many = [
      rule(0, "07:00", "08:00"),
      rule(1, "08:00", "09:00"),
      rule(2, "09:00", "10:00"),
      rule(3, "10:00", "11:00"),
    ];
    expect(activityScheduleLabel(many)).toBe("Pon 07:00 · Uto 08:00 · Sre 09:00 …");
    expect(activityScheduleLabel([])).toBeNull();
  });
});
