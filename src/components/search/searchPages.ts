import type { ComponentType, SVGProps } from "react";

import { NAV_SECTIONS, type NavSectionKey } from "@/components/layout/navSections";

/**
 * The pages group of the global search palette, derived from the nav's own
 * section list instead of a second hardcoded table.
 *
 * The palette used to carry its own page array, written before the 2026-08
 * redesign: it still offered the upcoming, payments and budget pages and had
 * never heard of calendar, money or school. Deriving from {@link NAV_SECTIONS}
 * means a new section is searchable the moment it is added, and a renamed one
 * can never go stale here.
 *
 * Kept free of any Supabase-touching import so the derivation stays unit
 * testable - `GlobalSearchDialog` itself reaches the client transitively.
 */
export interface SearchPage {
  /**
   * Section key, not the path: family and settings both live at `/settings`
   * and differ only by search params, so a path-keyed lookup would return the
   * wrong one.
   */
  id: string;
  to: string;
  search?: Record<string, string>;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** Navigable pages, matched by (normalized) name - "skola" finds "Škola". */
export const SEARCH_PAGES: readonly SearchPage[] = NAV_SECTIONS.map((section) => ({
  id: section.key,
  to: section.to,
  search: section.search,
  label: section.label,
  icon: section.icon,
}));

/** Lowercase + strip Serbian diacritics so "placanja" matches "Plaćanja". */
export function normalizeTerm(s: string): string {
  return s
    .toLowerCase()
    .replaceAll("đ", "dj")
    .replaceAll("č", "c")
    .replaceAll("ć", "c")
    .replaceAll("š", "s")
    .replaceAll("ž", "z");
}

/**
 * What the sections used to be called, so the old vocabulary still finds them.
 *
 * The redesign folded the upcoming page into the calendar and merged payments
 * + budget into money, but that is a rename, not a removal: the household
 * types what it typed last week. The app already forgives the old names in two
 * other places - stored `nav_slots` keys are mapped forward by
 * `LEGACY_KEY_MAP`, and the `/payments` and `/budget` routes still stand as
 * redirect stubs for bookmarks and push links - so search has no business
 * being the one surface that forgets.
 *
 * These are search TERMS, not URLs: they are what a person types into the
 * palette, and the palette still speaks Serbian because the labels do.
 * Deliberately NOT `LEGACY_KEY_MAP` itself: that one maps STORED English keys
 * (`payments`, `budget`). Same idea, different vocabularies - merging them
 * would force one table to serve both.
 *
 * Written in the form {@link normalizeTerm} produces (no diacritics,
 * lowercase), because that is what they are compared against; the test pins
 * that.
 */
const LEGACY_PAGE_NAMES: Readonly<Record<string, NavSectionKey>> = {
  uskoro: "calendar",
  placanja: "money",
  budzet: "money",
};

/** Everything a page answers to: its own label plus its pre-redesign names. */
const MATCH_TERMS: ReadonlyMap<string, readonly string[]> = new Map(
  SEARCH_PAGES.map((page) => [
    page.id,
    [
      normalizeTerm(page.label),
      ...Object.entries(LEGACY_PAGE_NAMES)
        .filter(([, key]) => key === page.id)
        .map(([name]) => name),
    ],
  ]),
);

/**
 * Pages matching a typed term, in canonical nav order. Diacritic-insensitive
 * and idempotent in the term (normalizing twice changes nothing), so callers
 * may hand over a raw or an already-normalized string.
 *
 * One pass over the pages, never one per matched name: a term that hits both a
 * label and an old name of the SAME section ("ac" is in both "Novac" and
 * "placanja") still returns that section exactly once.
 */
export function matchSearchPages(term: string): SearchPage[] {
  const q = normalizeTerm(term.trim());
  if (!q) return [];
  return SEARCH_PAGES.filter((page) => MATCH_TERMS.get(page.id)?.some((name) => name.includes(q)));
}
