import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAV_SLOTS,
  NAV_SECTIONS,
  normalizeNavSlots,
  resolveNavSectionKey,
  sectionForPathname,
} from "@/components/layout/navSections";

describe("normalizeNavSlots", () => {
  it("falls back to the default layout when the profile never customized", () => {
    expect(normalizeNavSlots(null)).toEqual([...DEFAULT_NAV_SLOTS]);
    expect(normalizeNavSlots(undefined)).toEqual([...DEFAULT_NAV_SLOTS]);
  });

  it("keeps a deliberate empty selection empty", () => {
    expect(normalizeNavSlots([])).toEqual([]);
  });

  it("passes through a valid selection in order", () => {
    expect(normalizeNavSlots(["lists", "birthdays"])).toEqual(["lists", "birthdays"]);
  });

  it("drops unknown keys, non-strings and the fixed danas", () => {
    expect(normalizeNavSlots(["today", "recepti", 42, null, "money"])).toEqual(["money"]);
  });

  it("dedupes and caps at two", () => {
    expect(normalizeNavSlots(["lists", "lists", "money", "events"])).toEqual(["lists", "money"]);
  });

  it("never puts Podešavanja in the bar", () => {
    expect(normalizeNavSlots(["settings", "lists"])).toEqual(["lists"]);
  });
});

describe("legacy nav_slots values (pre-redesign profiles)", () => {
  it("maps uskoro to calendar and both money sections to money", () => {
    expect(normalizeNavSlots(["uskoro", "payments"])).toEqual(["calendar", "money"]);
    expect(normalizeNavSlots(["budget", "lists"])).toEqual(["money", "lists"]);
  });

  it("collapses payments + budget into a single money slot", () => {
    expect(normalizeNavSlots(["payments", "budget", "lists"])).toEqual(["money", "lists"]);
  });

  it("keeps the sections whose key never changed", () => {
    expect(resolveNavSectionKey("activities")).toBe("activities");
    expect(resolveNavSectionKey("events")).toBe("events");
    expect(resolveNavSectionKey("birthdays")).toBe("birthdays");
    expect(resolveNavSectionKey("settings")).toBe("settings");
    expect(resolveNavSectionKey("danas")).toBe("today");
  });

  it("returns null for values that were never sections", () => {
    expect(resolveNavSectionKey("recepti")).toBeNull();
    expect(resolveNavSectionKey(42)).toBeNull();
    expect(resolveNavSectionKey(null)).toBeNull();
  });
});

describe("sectionForPathname", () => {
  it("maps the root exactly to today", () => {
    expect(sectionForPathname("/")).toBe("today");
  });

  it("maps section roots and their subroutes", () => {
    expect(sectionForPathname("/kalendar")).toBe("calendar");
    expect(sectionForPathname("/novac")).toBe("money");
    expect(sectionForPathname("/lists/abc-123")).toBe("lists");
    expect(sectionForPathname("/settings")).toBe("settings");
  });

  it("does not treat prefixes without a slash boundary as a match", () => {
    expect(sectionForPathname("/listsX")).toBeNull();
  });

  it("returns null for routes outside the sections", () => {
    expect(sectionForPathname("/login")).toBeNull();
  });

  it("covers every path-addressable section's own route", () => {
    for (const section of NAV_SECTIONS) {
      // Porodica shares /settings with Podešavanja and is only reached via an
      // explicit link, so path matching resolves it to settings.
      if (section.search) continue;
      expect(sectionForPathname(section.to)).toBe(section.key);
    }
  });
});
