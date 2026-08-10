import { resolveNavSectionKey, type NavSectionKey } from "@/components/layout/navSections";

/**
 * Per-device memory of recently visited sections for the "Nedavno" row in the
 * "Meni" sheet. Most-recent-first, deduped, capped - we keep a few more than
 * the sheet shows so entries that are currently in the bottom bar (and thus
 * filtered out of the row) don't leave it empty.
 *
 * Per-device on purpose (unlike the bar slots on the profile): what you
 * recently opened on the phone is device context, not a preference. Storage
 * failures (private mode, quota) degrade to "no memory" - the sheet just
 * renders without the row.
 */
const STORAGE_KEY = "nav.recents.v1";

/** Keep a small buffer beyond the 3 the sheet displays. */
const MAX_RECENTS = 6;

export function readNavRecents(): NavSectionKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<NavSectionKey>();
    for (const value of parsed) {
      // Pre-redesign keys are mapped forward (uskoro -> calendar, payments and
      // budget → novac), so a returning user's row isn't suddenly empty. The
      // dedupe below is what makes the payments+budget collapse harmless.
      const key = resolveNavSectionKey(value);
      if (key) seen.add(key);
      if (seen.size === MAX_RECENTS) break;
    }
    return [...seen];
  } catch {
    return [];
  }
}

export function recordNavRecent(key: NavSectionKey): void {
  if (typeof window === "undefined") return;
  try {
    const next = [key, ...readNavRecents().filter((k) => k !== key)].slice(0, MAX_RECENTS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort - the "Nedavno" row is a convenience, never a blocker.
  }
}
