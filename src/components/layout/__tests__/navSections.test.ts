import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAV_SLOTS,
  NAV_SECTIONS,
  normalizeNavSlots,
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
    expect(normalizeNavSlots(["budget", "lists", "birthdays"])).toEqual([
      "budget",
      "lists",
      "birthdays",
    ]);
  });

  it("drops unknown keys, non-strings and the fixed danas", () => {
    expect(normalizeNavSlots(["danas", "recepti", 42, null, "budget"])).toEqual(["budget"]);
  });

  it("dedupes and caps at three", () => {
    expect(normalizeNavSlots(["lists", "lists", "budget", "events", "payments"])).toEqual([
      "lists",
      "budget",
      "events",
    ]);
  });
});

describe("sectionForPathname", () => {
  it("maps the root exactly to danas", () => {
    expect(sectionForPathname("/")).toBe("danas");
  });

  it("maps section roots and their subroutes", () => {
    expect(sectionForPathname("/uskoro")).toBe("uskoro");
    expect(sectionForPathname("/payments")).toBe("payments");
    expect(sectionForPathname("/lists/abc-123")).toBe("lists");
    expect(sectionForPathname("/settings")).toBe("settings");
  });

  it("does not treat prefixes without a slash boundary as a match", () => {
    expect(sectionForPathname("/listsX")).toBeNull();
  });

  it("returns null for routes outside the nine sections", () => {
    expect(sectionForPathname("/login")).toBeNull();
  });

  it("covers every section's own route", () => {
    for (const section of NAV_SECTIONS) {
      expect(sectionForPathname(section.to)).toBe(section.key);
    }
  });
});
