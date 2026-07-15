import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";

/**
 * Family-scoped global search (the ⌘K dialog) — parallel `ilike` name/title
 * queries across every searchable entity, capped per group. Follows the data
 * hooks' conventions: `familyId` comes from `useProfile()` only (RLS enforces
 * the scope anyway), and a failed group degrades to an empty list rather than
 * failing the whole search.
 *
 * No realtime subscription — results are a transient snapshot; a short
 * staleTime plus `keepPreviousData` keeps typing flicker-free.
 */

export type SearchResultKind =
  | "page"
  | "activity"
  | "event"
  | "payment"
  | "birthday"
  | "list"
  | "list_item"
  | "external";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  /** Secondary line — date, amount, parent list… */
  subtitle: string | null;
  /** For `list_item`: the parent list to navigate to. */
  listId?: string;
}

/** Max hits per entity group. */
const MAX_PER_GROUP = 5;

/** Escape `ilike` wildcards so a literal % / _ in the term stays literal. */
function escapeIlikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

async function searchAll(familyId: string, term: string): Promise<SearchResult[]> {
  const pattern = `%${escapeIlikeTerm(term)}%`;

  const [activities, events, payments, birthdays, lists, listItems, external] = await Promise.all([
    supabase
      .from("activities")
      .select("id,name")
      .eq("family_id", familyId)
      .ilike("name", pattern)
      .order("name", { ascending: true })
      .limit(MAX_PER_GROUP),
    supabase
      .from("events")
      .select("id,name,date")
      .eq("family_id", familyId)
      .ilike("name", pattern)
      .order("date", { ascending: false })
      .limit(MAX_PER_GROUP),
    supabase
      .from("payments")
      .select("id,name,amount")
      .eq("family_id", familyId)
      .ilike("name", pattern)
      .order("due_date", { ascending: false })
      .limit(MAX_PER_GROUP),
    supabase
      .from("birthdays")
      .select("id,name,birth_date")
      .eq("family_id", familyId)
      .ilike("name", pattern)
      .order("name", { ascending: true })
      .limit(MAX_PER_GROUP),
    supabase
      .from("lists")
      .select("id,name")
      .eq("family_id", familyId)
      .ilike("name", pattern)
      .order("updated_at", { ascending: false })
      .limit(MAX_PER_GROUP),
    supabase
      .from("list_items")
      .select("id,name,list_id,lists(name)")
      .eq("family_id", familyId)
      .ilike("name", pattern)
      .order("updated_at", { ascending: false })
      .limit(MAX_PER_GROUP),
    supabase
      .from("external_calendar_events")
      .select("id,title,local_date")
      .eq("family_id", familyId)
      .ilike("title", pattern)
      .order("local_date", { ascending: false })
      .limit(MAX_PER_GROUP),
  ]);

  const results: SearchResult[] = [];

  for (const row of activities.data ?? []) {
    results.push({ kind: "activity", id: row.id, title: row.name, subtitle: null });
  }
  for (const row of events.data ?? []) {
    results.push({ kind: "event", id: row.id, title: row.name, subtitle: formatDate(row.date) });
  }
  for (const row of payments.data ?? []) {
    results.push({
      kind: "payment",
      id: row.id,
      title: row.name,
      subtitle: formatAmount(row.amount),
    });
  }
  for (const row of birthdays.data ?? []) {
    results.push({
      kind: "birthday",
      id: row.id,
      title: row.name,
      subtitle: formatDate(row.birth_date),
    });
  }
  for (const row of lists.data ?? []) {
    results.push({ kind: "list", id: row.id, title: row.name, subtitle: null });
  }
  for (const row of listItems.data ?? []) {
    // Nested select — Supabase types it loosely, so normalize object/array.
    const parent = row.lists as { name: string } | { name: string }[] | null;
    const parentName = Array.isArray(parent) ? (parent[0]?.name ?? null) : (parent?.name ?? null);
    results.push({
      kind: "list_item",
      id: row.id,
      title: row.name,
      subtitle: parentName,
      listId: row.list_id,
    });
  }
  for (const row of external.data ?? []) {
    results.push({
      kind: "external",
      id: row.id,
      title: row.title ?? "(bez naslova)",
      subtitle: formatDate(row.local_date),
    });
  }

  return results;
}

export interface UseGlobalSearchResult {
  results: SearchResult[];
  /** True while a search round-trip is in flight (including refetches). */
  isSearching: boolean;
  /** False until the term is long enough to search on. */
  enabled: boolean;
}

/** Minimum characters before firing the queries. */
export const MIN_SEARCH_CHARS = 2;

/** Stable empty result — keeps consumers' memo/effect deps quiet while disabled. */
const NO_RESULTS: SearchResult[] = [];

export function useGlobalSearch(term: string): UseGlobalSearchResult {
  const { familyId } = useProfile();
  const trimmed = term.trim();
  const enabled = !!familyId && trimmed.length >= MIN_SEARCH_CHARS;

  const query = useQuery({
    queryKey: ["global-search", familyId, trimmed.toLowerCase()],
    queryFn: () => searchAll(familyId as string, trimmed),
    enabled,
    staleTime: 30_000,
    // Keep showing the previous hits while the next term's fetch runs.
    placeholderData: keepPreviousData,
  });

  return {
    results: enabled ? (query.data ?? NO_RESULTS) : NO_RESULTS,
    isSearching: enabled && query.isFetching,
    enabled,
  };
}
