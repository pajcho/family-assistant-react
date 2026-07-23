import { useCallback, useMemo, useState } from "react";

import {
  type AgendaFilter,
  type AgendaKind,
  agendaFilterCount,
  isAgendaFilterActive,
} from "@/utils/agendaFilters";

/**
 * Holds the dashboard's type + person filter selection. State only - the
 * matching logic is the pure helpers in `utils/agendaFilters`, applied by each
 * tab to its `useAgenda` items. Lifted to the dashboard route so the selection
 * is shared across the Danas and Uskoro tabs.
 *
 * Both facets follow the same convention as the activities page chips: an
 * EMPTY set means "no filter" (everything passes), a non-empty set narrows.
 */
export interface UseAgendaFiltersResult {
  filter: AgendaFilter;
  toggleKind: (kind: AgendaKind) => void;
  togglePerson: (personId: string) => void;
  reset: () => void;
  isActive: boolean;
  count: number;
}

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function useAgendaFilters(): UseAgendaFiltersResult {
  const [kinds, setKinds] = useState<ReadonlySet<AgendaKind>>(() => new Set());
  const [personIds, setPersonIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggleKind = useCallback((kind: AgendaKind) => {
    setKinds((prev) => toggle(prev, kind));
  }, []);

  const togglePerson = useCallback((personId: string) => {
    setPersonIds((prev) => toggle(prev, personId));
  }, []);

  const reset = useCallback(() => {
    setKinds(new Set());
    setPersonIds(new Set());
  }, []);

  const filter = useMemo<AgendaFilter>(() => ({ kinds, personIds }), [kinds, personIds]);

  return {
    filter,
    toggleKind,
    togglePerson,
    reset,
    isActive: isAgendaFilterActive(filter),
    count: agendaFilterCount(filter),
  };
}
