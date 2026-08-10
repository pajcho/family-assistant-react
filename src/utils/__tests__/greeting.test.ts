import { describe, expect, it } from "vitest";
import { startOfDay } from "date-fns";

import { greetingFor } from "../greeting";

describe("greetingFor", () => {
  it("picks the greeting off the clock", () => {
    expect(greetingFor(new Date(2026, 7, 10, 2, 30))).toBe("Dobro veče");
    expect(greetingFor(new Date(2026, 7, 10, 8, 0))).toBe("Dobro jutro");
    expect(greetingFor(new Date(2026, 7, 10, 13, 15))).toBe("Dobar dan");
    expect(greetingFor(new Date(2026, 7, 10, 21, 45))).toBe("Dobro veče");
  });

  it("reads the current time when called with no argument", () => {
    expect(greetingFor()).toBe(greetingFor(new Date()));
  });

  it("is not called with a midnight-normalized date", () => {
    // Regression: the Danas header used to pass `useToday().date`, which is
    // local midnight - so `getHours()` was always 0 and the header read
    // "Dobro veče" at every hour of the day.
    const middayIsNotMidnight = greetingFor(new Date(2026, 7, 10, 12, 0));
    expect(middayIsNotMidnight).not.toBe(greetingFor(startOfDay(new Date(2026, 7, 10, 12, 0))));
  });
});
