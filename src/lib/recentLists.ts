/**
 * Per-device memory of the lists this person actually uses.
 *
 * Two jobs, one store. The desktop master-detail split re-opens whatever was
 * last viewed instead of forcing a fresh pick, and the mobile grid puts the
 * lists you keep opening on top - which is the whole reason the grid stopped
 * being ordered by creation date.
 *
 * Per-device on purpose, and per-device rather than family-wide for a second
 * reason: `lists.updated_at` bumps whenever ANYBODY ticks anything inside a
 * list, so an order driven by it alone reshuffles under you because somebody
 * else did the shopping. What you opened is yours.
 *
 * Best-effort throughout: an absent, unreadable or unwritable store just means
 * "no memory yet" and every caller has a fallback. Stale ids are never pruned
 * here - the readers filter against the lists they actually loaded, which is
 * the only place that knows whether an id still exists.
 */
const STORAGE_KEY = "lists.recentIds.v1";

/** The single-id key this replaced. Read once, so the memory survives the upgrade. */
const LEGACY_KEY = "lists.lastOpenedId.v1";

/** How many to remember. Past a handful it stops being "recent" and becomes the list of lists. */
const MAX_RECENT = 8;

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
      }
      return [];
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    return legacy && legacy.length > 0 ? [legacy] : [];
  } catch {
    // Storage disabled (private mode) or a corrupt value - behave as if empty.
    return [];
  }
}

/** Most recently opened first. */
export function readRecentListIds(): string[] {
  return read();
}

/** The single most recent, which is what the desktop pane opens on. */
export function readLastOpenedListId(): string | null {
  return read()[0] ?? null;
}

/** Move a list to the front, dedup, cap. Call it when a list is USED, not rendered. */
export function pushRecentListId(id: string): void {
  if (typeof window === "undefined" || !id) return;
  const next = [id, ...read().filter((existing) => existing !== id)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded / private mode - persistence is best-effort, the UI still works.
  }
}
