import { describe, expect, it } from "vitest";

import {
  rankLinkSuggestions,
  receiptSuggestContext,
  type SuggestionCandidate,
} from "@/utils/linkSuggestions";

/**
 * A scanned fiscal receipt is the only money entry that knows the CLOCK TIME
 * of the spend, and that time is what pins it to whatever termin was running.
 * These pin the two halves of that: pulling the time out of `issuedAt`, and
 * the ranker actually using it.
 */

describe("receiptSuggestContext", () => {
  it("pulls the Belgrade-local time out of the parsed timestamp", () => {
    expect(
      receiptSuggestContext({ merchant: "Maxi", issuedAt: "2026-08-10T18:12:41+02:00" }),
    ).toEqual({ name: "Maxi", date: "2026-08-10", time: "18:12" });
  });

  it("yields no time for a stored receipt, which keeps only issued_on", () => {
    // The DB column is a DATE - the fast path re-reads it as a bare "issuedAt",
    // so the time signal has to switch itself off rather than parse garbage.
    expect(receiptSuggestContext({ merchant: null, issuedAt: "2026-08-10" })).toEqual({
      name: null,
      date: "2026-08-10",
      time: null,
    });
  });

  it("links the receipt to the termin it was issued during", () => {
    const english: SuggestionCandidate = {
      kind: "activity",
      id: "english",
      name: "Engleski",
      daySlots: [{ startTime: "17:00", endTime: "18:00" }],
    };
    const context = receiptSuggestContext({
      merchant: "Škola stranih jezika",
      issuedAt: "2026-08-10T18:12:41+02:00",
    });

    const [top] = rankLinkSuggestions([english], context);
    expect(top).toMatchObject({ candidate: { id: "english" }, reason: "time" });
  });
});
