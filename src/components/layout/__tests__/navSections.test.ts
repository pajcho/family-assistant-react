import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAV_SLOTS,
  MENU_GRID_SECTIONS,
  NAV_SECTIONS,
  NAV_SECTION_MAP,
  isNavSectionActive,
  normalizeNavSlots,
  resolveNavSectionKey,
  sectionForPathname,
} from "@/components/layout/navSections";
import { NAV_SHORTCUT_KEYS } from "@/lib/shortcuts";

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

  it("lets Škola take a slot like any other destination", () => {
    expect(normalizeNavSlots(["school", "money"])).toEqual(["school", "money"]);
  });
});

describe("the Meni grid", () => {
  it("stays a whole number of 3-column rows", () => {
    // The tiles are a 3-col grid; a count off the multiple leaves a lonely
    // last row. Adding a section means deciding where it goes, not shipping
    // an orphan tile.
    expect(MENU_GRID_SECTIONS.length % 3).toBe(0);
  });

  it("holds every section except Podešavanja, which has its own row", () => {
    expect(MENU_GRID_SECTIONS.map((section) => section.key)).toEqual(
      NAV_SECTIONS.filter((section) => section.key !== "settings").map((section) => section.key),
    );
  });
});

describe("the section list itself", () => {
  it("has no duplicate keys or routes-plus-search pairs", () => {
    const keys = NAV_SECTIONS.map((section) => section.key);
    expect(new Set(keys).size).toBe(keys.length);

    const destinations = NAV_SECTIONS.map(
      (section) => `${section.to}?${new URLSearchParams(section.search ?? {}).toString()}`,
    );
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it("gives every section a distinct G-chord letter", () => {
    const letters = NAV_SECTIONS.map((section) => NAV_SHORTCUT_KEYS[section.key]);
    expect(letters.every((letter) => /^[A-Z]$/.test(letter))).toBe(true);
    expect(new Set(letters).size).toBe(letters.length);
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
    expect(sectionForPathname("/calendar")).toBe("calendar");
    expect(sectionForPathname("/money")).toBe("money");
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
      // Family shares /settings with settings and is only reached via an
      // explicit link, so path matching resolves it to settings.
      if (section.search) continue;
      expect(sectionForPathname(section.to)).toBe(section.key);
    }
  });
});

describe("isNavSectionActive", () => {
  const porodica = NAV_SECTION_MAP.family;
  const podesavanja = NAV_SECTION_MAP.settings;

  it("lights Porodica - not Podešavanja - on its own link", () => {
    expect(isNavSectionActive(porodica, "/settings", { tab: "family" })).toBe(true);
    expect(isNavSectionActive(podesavanja, "/settings", { tab: "family" })).toBe(false);
  });

  it("gives Podešavanja the hub and every other tab", () => {
    expect(isNavSectionActive(podesavanja, "/settings", {})).toBe(true);
    expect(isNavSectionActive(podesavanja, "/settings", { tab: "notifications" })).toBe(true);
    expect(isNavSectionActive(porodica, "/settings", {})).toBe(false);
  });

  it("matches subroutes but not bare prefixes", () => {
    expect(isNavSectionActive(NAV_SECTION_MAP.lists, "/lists/abc-123", {})).toBe(true);
    expect(isNavSectionActive(NAV_SECTION_MAP.lists, "/listsX", {})).toBe(false);
  });

  it("keeps Danas exact so every other screen turns it off", () => {
    expect(isNavSectionActive(NAV_SECTION_MAP.today, "/", {})).toBe(true);
    expect(isNavSectionActive(NAV_SECTION_MAP.today, "/calendar", {})).toBe(false);
  });

  it("ignores search params on sections that do not share a path", () => {
    expect(isNavSectionActive(NAV_SECTION_MAP.money, "/money", { tab: "payments" })).toBe(true);
  });
});
