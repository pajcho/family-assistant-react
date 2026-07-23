/**
 * Per-device memory of the last list the user opened.
 *
 * On desktop the lists view is a persistent master-detail split, so returning
 * to `/lists` re-opens whatever was last viewed instead of forcing a fresh
 * pick. Stored as a bare id string under one localStorage key; an absent or
 * unreadable value just means "no memory yet" and the caller falls back to the
 * first list. We never need to proactively clear a stale id - the resolver
 * re-checks that the id still exists and falls through to the first list if not.
 *
 * Per-device on purpose: which list you had open on your phone shouldn't
 * dictate what opens on your laptop. The panel split size is persisted
 * separately by `react-resizable-panels` via `useDefaultLayout`.
 */
const STORAGE_KEY = "lists.lastOpenedId.v1";

export function readLastOpenedListId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    // Storage disabled (private mode) - behave as if there's no memory.
    return null;
  }
}

export function writeLastOpenedListId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Quota exceeded / private mode - persistence is best-effort, the UI still works.
  }
}
