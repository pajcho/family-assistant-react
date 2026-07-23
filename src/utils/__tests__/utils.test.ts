import { describe, expect, it } from "vitest";
import { addDays, format } from "date-fns";

import { addMonth, dueDayLabel, isOverdue, subtractMonth } from "../date";
import { daysUntilBirthday } from "../birthday";
import { formatAmount } from "../format";
import { getDisplayName, getInitials } from "../identity";
import { parseUserAgent } from "../userAgent";

describe("utils", () => {
  it("addMonth caps Jan 31 to last day of February (2026 is not a leap year)", () => {
    expect(addMonth("2026-01-31")).toBe("2026-02-28");
  });

  it("subtractMonth caps Mar 31 to last day of February", () => {
    expect(subtractMonth("2026-03-31")).toBe("2026-02-28");
  });

  it("daysUntilBirthday returns ~10 for a birth date 10 days from today (any year)", () => {
    // Pick a birth date whose MM-DD is exactly 10 days from today. Year doesn't matter -
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

  describe("dueDayLabel", () => {
    // Build a YYYY-MM-DD string that is exactly `n` days from today (local).
    const rel = (n: number) => format(addDays(new Date(), n), "yyyy-MM-dd");

    it("returns 'danas' for today", () => {
      expect(dueDayLabel(rel(0))).toBe("danas");
    });

    it("returns 'sutra' for tomorrow", () => {
      expect(dueDayLabel(rel(1))).toBe("sutra");
    });

    it("returns 'za N dana' for the next-week boundary (recurring weekly reappears here)", () => {
      expect(dueDayLabel(rel(2))).toBe("za 2 dana");
      expect(dueDayLabel(rel(7))).toBe("za 7 dana");
    });

    it("returns 'kasni …' for overdue dates", () => {
      expect(dueDayLabel(rel(-1))).toBe("kasni 1 dan");
      expect(dueDayLabel(rel(-3))).toBe("kasni 3 dana");
    });
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
      expect(getDisplayName({ firstName: "Nikola", lastName: "Pajic", email: "x@y.com" })).toBe(
        "Nikola Pajic",
      );
    });

    it("getDisplayName falls back to email when name missing", () => {
      expect(getDisplayName({ email: "nikola@gmail.com" })).toBe("nikola@gmail.com");
    });
  });

  describe("parseUserAgent", () => {
    it("recognises Chrome on macOS", () => {
      const ua =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      expect(parseUserAgent(ua)).toMatchObject({
        browser: "Chrome",
        os: "macOS",
        label: "Chrome · macOS",
      });
    });

    it("recognises Safari on iPhone (not Chrome, even with Safari/ in UA)", () => {
      const ua =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
      expect(parseUserAgent(ua)).toMatchObject({
        browser: "Safari",
        os: "iPhone",
        label: "Safari · iPhone",
      });
    });

    it("recognises Firefox on Windows", () => {
      const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
      expect(parseUserAgent(ua)).toMatchObject({
        browser: "Firefox",
        os: "Windows",
        label: "Firefox · Windows",
      });
    });

    it("recognises Edge as Edge, not Chrome", () => {
      const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
      expect(parseUserAgent(ua).browser).toBe("Edge");
    });

    it("recognises Android", () => {
      const ua =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
      expect(parseUserAgent(ua).os).toBe("Android");
    });

    it("returns fallback label for empty/null UA", () => {
      expect(parseUserAgent(null).label).toBe("Nepoznat uređaj");
      expect(parseUserAgent("").label).toBe("Nepoznat uređaj");
    });
  });
});
