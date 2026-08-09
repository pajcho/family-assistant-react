import { describe, expect, it } from "vitest";

import { NAV_SECTIONS } from "@/components/layout/navSections";
import { SEARCH_PAGES } from "@/components/search/searchPages";

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
    // Porodica and Podešavanja share /settings; a path-keyed list would collide.
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
    const stubs = ["/uskoro", "/payments", "/budget"];
    for (const page of SEARCH_PAGES) {
      expect(stubs).not.toContain(page.to);
    }
  });

  it("carries Porodica's search params through", () => {
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
