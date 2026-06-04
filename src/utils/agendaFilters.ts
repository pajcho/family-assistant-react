import type { AgendaItem } from "@/hooks/useAgenda";

/**
 * Pure type + person filtering over `useAgenda` output. Kept here (not in the
 * hook) so both dashboard tabs — and, later, the Phase 4 calendar — apply the
 * exact same predicate, and so the rules are unit-testable without standing up
 * the data layer. State lives in `useAgendaFilters`; the UI in `AgendaFilters`.
 */

export type AgendaKind = AgendaItem["kind"];

/** Canonical display order for the four item kinds. */
export const AGENDA_KINDS: readonly AgendaKind[] = ["activity", "event", "payment", "birthday"];

export interface AgendaFilter {
  /** Selected kinds. Empty = no type filter (all kinds shown). */
  kinds: ReadonlySet<AgendaKind>;
  /** Selected person ids. Empty = no person filter (all people shown). */
  personIds: ReadonlySet<string>;
}

/** The neutral filter — everything passes. */
export const EMPTY_AGENDA_FILTER: AgendaFilter = {
  kinds: new Set<AgendaKind>(),
  personIds: new Set<string>(),
};

/** People an item is "about", for the person filter. Birthdays have none. */
export function agendaItemPersonIds(item: AgendaItem): string[] {
  switch (item.kind) {
    case "activity":
      return [item.block.personId];
    case "event":
    case "payment":
      return item.personIds;
    case "birthday":
      return [];
  }
}

/**
 * Whether an item survives the filter.
 *
 * - Type: with kinds selected, only those kinds pass.
 * - Person: with people selected, an item passes only if it's assigned to at
 *   least one of them. **Birthdays are exempt — always shown** (they carry no
 *   person, and there are few of them). An unassigned event/payment is hidden
 *   while a person filter is active (it's nobody's).
 */
export function matchesAgendaFilter(item: AgendaItem, filter: AgendaFilter): boolean {
  if (filter.kinds.size > 0 && !filter.kinds.has(item.kind)) return false;
  if (filter.personIds.size > 0 && item.kind !== "birthday") {
    const ids = agendaItemPersonIds(item);
    if (!ids.some((id) => filter.personIds.has(id))) return false;
  }
  return true;
}

export function filterAgendaItems(items: AgendaItem[], filter: AgendaFilter): AgendaItem[] {
  if (!isAgendaFilterActive(filter)) return items;
  return items.filter((item) => matchesAgendaFilter(item, filter));
}

/** Group already-filtered items into the `byDay` / `days` shape `useAgenda` returns. */
export function groupAgendaByDay(items: AgendaItem[]): {
  byDay: Map<string, AgendaItem[]>;
  days: string[];
} {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const arr = byDay.get(item.date);
    if (arr) arr.push(item);
    else byDay.set(item.date, [item]);
  }
  return { byDay, days: [...byDay.keys()].sort() };
}

export function isAgendaFilterActive(filter: AgendaFilter): boolean {
  return filter.kinds.size > 0 || filter.personIds.size > 0;
}

/** Count of active filter facets — drives the mobile "Filteri" badge. */
export function agendaFilterCount(filter: AgendaFilter): number {
  return filter.kinds.size + filter.personIds.size;
}
