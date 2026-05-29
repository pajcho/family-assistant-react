import { useCallback, useEffect, useState } from "react";

/**
 * Per-device persistence of which list cards on the /lists overview are
 * currently collapsed. We store only the *collapsed* ids — an absent id
 * defaults to expanded, matching the current behaviour for users who
 * haven't touched the toggle. The set is serialised as a JSON array under
 * a single localStorage key.
 *
 * State is intentionally per-device, not per-family: collapsing a list on
 * a phone shouldn't hide it on a laptop. If we ever want sync, we'd add
 * a `user_preferences` table and switch the persistence layer there
 * without changing the hook's surface.
 */

const STORAGE_KEY = "lists.overview.collapsed.v1";

function readInitial(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // Corrupted JSON or storage disabled — start clean rather than blow up.
    return new Set();
  }
}

function persist(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Quota exceeded / private mode — silently ignore. The UI still works
    // for the lifetime of the session, only persistence is lost.
  }
}

export interface UseCollapsedListsResult {
  /** True when this list id has been collapsed by the user. */
  isCollapsed: (id: string) => boolean;
  /** Flip a single list's collapsed state. */
  toggle: (id: string) => void;
  /** Mark all of `ids` collapsed (used by "Skupi sve"). */
  collapseAll: (ids: string[]) => void;
  /** Clear every collapsed entry (used by "Razvij sve"). */
  expandAll: () => void;
  /**
   * True when every supplied id is currently collapsed — drives the
   * Skupi-all / Razvij-all label flip in the page header.
   */
  isAllCollapsed: (ids: string[]) => boolean;
}

export function useCollapsedLists(): UseCollapsedListsResult {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(readInitial);

  // Persist whenever the set changes. Cheap (one localStorage write per
  // toggle) and avoids the layering complexity of a sync external store.
  useEffect(() => {
    persist(collapsedIds);
  }, [collapsedIds]);

  const isCollapsed = useCallback((id: string) => collapsedIds.has(id), [collapsedIds]);

  const toggle = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback((ids: string[]) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const isAllCollapsed = useCallback(
    (ids: string[]) => ids.length > 0 && ids.every((id) => collapsedIds.has(id)),
    [collapsedIds],
  );

  return { isCollapsed, toggle, collapseAll, expandAll, isAllCollapsed };
}
