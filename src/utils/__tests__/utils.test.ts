import { describe, expect, it } from "vitest";
import { addDays, format } from "date-fns";

import { addMonth, isOverdue, subtractMonth } from "../date";
import { daysUntilBirthday } from "../birthday";
import { formatAmount } from "../format";
import { getDisplayName, getInitials } from "../identity";

describe("utils", () => {
  it("addMonth caps Jan 31 to last day of February (2026 is not a leap year)", () => {
    expect(addMonth("2026-01-31")).toBe("2026-02-28");
  });

  it("subtractMonth caps Mar 31 to last day of February", () => {
    expect(subtractMonth("2026-03-31")).toBe("2026-02-28");
  });

  it("daysUntilBirthday returns ~10 for a birth date 10 days from today (any year)", () => {
    // Pick a birth date whose MM-DD is exactly 10 days from today. Year doesn't matter —
    // the util computes the next birthday from today and only the month/day are used to
    // decide whether the next occurrence falls this year or next.
    const target = addDays(new Date(), 10);
    const birthDate = `1990-${format(target, "MM-dd")}`;
    const days = daysUntilBirthday(birthDate);
    // Allow ±1 to absorb any sub-day rounding around midnight.
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });

  it("formatAmount formats 2500 as Serbian Latin RSD string", () => {
    expect(formatAmount(2500)).toBe("2.500 RSD");
  });

  it("isOverdue returns true for a date well in the past", () => {
    expect(isOverdue("2020-01-01")).toBe(true);
  });

  describe("identity", () => {
    it("getInitials returns first+last letter when both names set", () => {
      expect(getInitials({ firstName: "Nikola", lastName: "Pajic" })).toBe("NP");
    });

    it("getInitials returns single letter when only first name set", () => {
      expect(getInitials({ firstName: "Nikola", lastName: null })).toBe("N");
    });

    it("getInitials splits email on dots when no name set", () => {
      expect(getInitials({ email: "nikola.pajic@gmail.com" })).toBe("NP");
    });

    it("getInitials splits email on dashes/underscores", () => {
      expect(getInitials({ email: "nikola-pajic@gmail.com" })).toBe("NP");
      expect(getInitials({ email: "nikola_pajic@gmail.com" })).toBe("NP");
    });

    it("getInitials returns single email letter when no separators", () => {
      expect(getInitials({ email: "nikola@gmail.com" })).toBe("N");
    });

    it("getDisplayName prefers full name over email", () => {
      expect(
        getDisplayName({ firstName: "Nikola", lastName: "Pajic", email: "x@y.com" }),
      ).toBe("Nikola Pajic");
    });

    it("getDisplayName falls back to email when name missing", () => {
      expect(getDisplayName({ email: "nikola@gmail.com" })).toBe("nikola@gmail.com");
    });
  });
});
