import { describe, expect, it } from "vitest";

import { NAV_SECTIONS } from "@/components/layout/navSections";
import { SEARCH_PAGES, matchSearchPages, normalizeTerm } from "@/components/search/searchPages";

/**
 * Pins the derivation, not the palette: the point of these is that the search
 * page list cannot drift away from the nav again. The count assertion moves
 * with NAV_SECTIONS - update it when a section is added or removed.
 */

describe("SEARCH_PAGES", () => {
  it("covers every nav section exactly once", () => {
    expect(SEARCH_PAGES).toHaveLength(NAV_SECTIONS.length);
    expect(SEARCH_PAGES).toHaveLength(10);
    expect(SEARCH_PAGES.map((page) => page.id)).toEqual(NAV_SECTIONS.map((section) => section.key));
  });

  it("keys pages by section key, so the ids stay unique", () => {
    // Family and settings share /settings; a path-keyed list would collide.
    const ids = SEARCH_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers the sections the old hardcoded list had never heard of", () => {
    const labels = SEARCH_PAGES.map((page) => page.label);
    expect(labels).toContain("Kalendar");
    expect(labels).toContain("Novac");
    expect(labels).toContain("Škola");
  });

  it("points at no pre-redesign redirect stub", () => {
    const stubs = ["/payments", "/budget"];
    for (const page of SEARCH_PAGES) {
      expect(stubs).not.toContain(page.to);
    }
  });

  it("carries the family section's search params through", () => {
    const family = SEARCH_PAGES.find((page) => page.id === "family");
    expect(family?.to).toBe("/settings");
    expect(family?.search?.tab).toBe("family");
  });

  it("leaves the sections that link without params alone", () => {
    const settings = SEARCH_PAGES.find((page) => page.id === "settings");
    expect(settings?.to).toBe("/settings");
    expect(settings?.search).toBeUndefined();
  });
});

describe("matchSearchPages", () => {
  it("matches a label, diacritics or not", () => {
    expect(matchSearchPages("skola").map((page) => page.id)).toEqual(["school"]);
    expect(matchSearchPages("Škola").map((page) => page.id)).toEqual(["school"]);
    expect(matchSearchPages("rodjendani").map((page) => page.id)).toEqual(["birthdays"]);
  });

  it("still finds the sections under their pre-redesign names", () => {
    expect(matchSearchPages("uskoro").map((page) => page.id)).toEqual(["calendar"]);
    expect(matchSearchPages("placanja").map((page) => page.id)).toEqual(["money"]);
    expect(matchSearchPages("budzet").map((page) => page.id)).toEqual(["money"]);
  });

  it("shows an old name's hit under the section's CURRENT identity", () => {
    // Typing "uskoro" must offer "Kalendar" - the row is where the content
    // lives now, not a ghost of the page that used to hold it.
    const [upcoming] = matchSearchPages("uskoro");
    expect(upcoming?.label).toBe("Kalendar");
    expect(upcoming?.to).toBe("/calendar");

    const [payments] = matchSearchPages("placanja");
    expect(payments?.label).toBe("Novac");
    expect(payments?.to).toBe("/money");
  });

  it("returns a section once even when both its label and an old name match", () => {
    // "ac" is inside "Novac" and inside "placanja", money's pre-redesign name.
    // Since Liste became Zadaci it is inside that label too, which makes this a
    // better case than it was: the point is that money appears ONCE despite
    // matching twice, not that it is the only section that can match.
    const ids = matchSearchPages("ac").map((page) => page.id);
    expect(ids.filter((id) => id === "money")).toEqual(["money"]);
    expect(ids).toEqual(["money", "tasks"]);
  });

  it("keeps the canonical nav order and ignores an empty term", () => {
    // "a" is in "Danas", "Kalendar", "Novac"... - the order is NAV_SECTIONS'.
    const ids = matchSearchPages("a").map((page) => page.id);
    expect(ids).toEqual(
      NAV_SECTIONS.map((section) => section.key).filter((key) => ids.includes(key)),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(matchSearchPages("   ")).toEqual([]);
  });

  it("compares against the same normalized form the old names are written in", () => {
    // The table is hand-written; if an entry carried a diacritic it could never
    // match, because the typed term is normalized before the comparison.
    for (const name of ["uskoro", "placanja", "budzet"]) {
      expect(normalizeTerm(name)).toBe(name);
      expect(matchSearchPages(name)).not.toHaveLength(0);
    }
    expect(normalizeTerm("Plaćanja")).toBe("placanja");
    expect(normalizeTerm("Budžet")).toBe("budzet");
  });
});
