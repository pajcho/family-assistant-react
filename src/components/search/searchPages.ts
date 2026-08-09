import type { ComponentType, SVGProps } from "react";

import { NAV_SECTIONS } from "@/components/layout/navSections";

/**
 * The "Stranice" group of the global search palette, derived from the nav's own
 * section list instead of a second hardcoded table.
 *
 * The palette used to carry its own page array, written before the 2026-08
 * redesign: it still offered Uskoro, Plaćanja and Budžet (now redirect stubs)
 * and had never heard of Kalendar, Novac or Škola. Deriving from
 * {@link NAV_SECTIONS} means a new section is searchable the moment it is added,
 * and a renamed one can never go stale here.
 *
 * Kept free of any Supabase-touching import so the derivation stays unit
 * testable - `GlobalSearchDialog` itself reaches the client transitively.
 */
export interface SearchPage {
  /**
   * Section key, not the path: Porodica and Podešavanja both live at
   * `/settings` and differ only by search params, so a path-keyed lookup would
   * return the wrong one.
   */
  id: string;
  to: string;
  search?: Record<string, string>;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** Navigable pages, matched by (normalized) name - "skola" finds Škola. */
export const SEARCH_PAGES: readonly SearchPage[] = NAV_SECTIONS.map((section) => ({
  id: section.key,
  to: section.to,
  search: section.search,
  label: section.label,
  icon: section.icon,
}));
