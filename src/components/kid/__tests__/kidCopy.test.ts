import { describe, expect, it } from "vitest";

import {
  attemptsLeftLine,
  classesWord,
  countdownLabel,
  daysBetween,
  daysWord,
  formatKidLongDate,
  formatKidShortDate,
  formatLockCountdown,
  kidDayHeading,
  pluralSr,
  weekdayName,
} from "@/components/kid/kidCopy";

/**
 * Serbian pluralisation and countdown wording. The kid shell replaces dates
 * with countdowns almost everywhere, so getting "za 21 dan" vs "za 22 dana"
 * right is not a nicety - it is most of what the screen says.
 */

describe("pluralSr", () => {
  it("picks one / few / many by the last digit", () => {
    expect(pluralSr(1, "dan", "dana", "dana")).toBe("dan");
    expect(pluralSr(2, "dan", "dana", "dana")).toBe("dana");
    expect(pluralSr(4, "dan", "dana", "dana")).toBe("dana");
    expect(pluralSr(5, "dan", "dana", "dana")).toBe("dana");
    expect(pluralSr(21, "dan", "dana", "dana")).toBe("dan");
  });

  it("treats 11-14 as many, not as their last digit", () => {
    expect(pluralSr(11, "cas", "casa", "casova")).toBe("casova");
    expect(pluralSr(12, "cas", "casa", "casova")).toBe("casova");
    expect(pluralSr(14, "cas", "casa", "casova")).toBe("casova");
    // ...while 111 follows the same rule, and 101 does not.
    expect(pluralSr(111, "cas", "casa", "casova")).toBe("casova");
    expect(pluralSr(101, "cas", "casa", "casova")).toBe("cas");
  });

  it("drives the concrete word helpers", () => {
    expect(daysWord(1)).toBe("dan");
    expect(daysWord(9)).toBe("dana");
    expect(classesWord(1)).toBe("čas");
    expect(classesWord(2)).toBe("časa");
    expect(classesWord(5)).toBe("časova");
  });
});

describe("countdownLabel", () => {
  it("names the near days instead of counting them", () => {
    expect(countdownLabel(0)).toBe("danas");
    expect(countdownLabel(1)).toBe("sutra");
    expect(countdownLabel(2)).toBe("prekosutra");
  });

  it("counts from three days out, with the right plural", () => {
    expect(countdownLabel(3)).toBe("za 3 dana");
    expect(countdownLabel(9)).toBe("za 9 dana");
    expect(countdownLabel(21)).toBe("za 21 dan");
  });
});

describe("dates", () => {
  it("formats long and short dates in Serbian", () => {
    // 2026-10-05 is a Monday.
    expect(formatKidLongDate("2026-10-05")).toBe("ponedeljak, 5. oktobar");
    expect(formatKidShortDate("2026-10-05")).toBe("5. okt");
    expect(weekdayName("2026-10-10")).toBe("subota");
  });

  it("counts whole calendar days regardless of month boundaries", () => {
    expect(daysBetween("2026-10-05", "2026-10-05")).toBe(0);
    expect(daysBetween("2026-10-05", "2026-10-14")).toBe(9);
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-10-05", "2026-10-01")).toBe(-4);
  });
});

describe("kidDayHeading", () => {
  const today = "2026-10-05";

  it("says Danas / Sutra rather than showing a chip", () => {
    expect(kidDayHeading("2026-10-05", today)).toEqual({
      title: "Danas · ponedeljak 5. okt",
      chip: null,
    });
    expect(kidDayHeading("2026-10-06", today)).toEqual({
      title: "Sutra · utorak 6. okt",
      chip: null,
    });
  });

  it("keeps two days out chip-free, then starts counting", () => {
    expect(kidDayHeading("2026-10-07", today)).toEqual({ title: "Sreda · 7. okt", chip: null });
    expect(kidDayHeading("2026-10-10", today)).toEqual({
      title: "Subota · 10. okt",
      chip: "za 5 dana",
    });
  });
});

describe("login wording", () => {
  it("counts a lockout down in minutes, then seconds", () => {
    expect(formatLockCountdown(900)).toBe("za 15 minuta");
    expect(formatLockCountdown(61)).toBe("za 2 minuta");
    expect(formatLockCountdown(40)).toBe("za 40 sekundi");
    expect(formatLockCountdown(1)).toBe("za 1 sekundu");
    expect(formatLockCountdown(0)).toBe("za 0 sekundi");
  });

  it("declines the attempts left", () => {
    expect(attemptsLeftLine(3)).toBe("Imaš još 3 pokušaja.");
    expect(attemptsLeftLine(1)).toBe("Imaš još 1 pokušaj.");
    expect(attemptsLeftLine(0)).toBe("Nema više pokušaja.");
  });
});
