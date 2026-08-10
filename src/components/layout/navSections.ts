import type { ComponentType, SVGProps } from "react";
import {
  AcademicCapIcon,
  CakeIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ClipboardDocumentCheckIcon,
  Cog6ToothIcon,
  SparklesIcon,
  SunIcon,
  UserGroupIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";

/**
 * Single source of truth for the app's ten navigation destinations: the mobile
 * bottom bar, the menu sheet and the desktop nav all render from this list, so
 * a new section is added exactly once.
 *
 * Redesign 2.0 reshaped the map:
 *   - the old "upcoming" page became the agenda view inside CALENDAR (which
 *     also owns the new week and month views);
 *   - payments + budget merged into MONEY (overview / expenses / payments);
 *   - family surfaced as its own destination (a section of settings).
 *
 * SCHOOL joined later, for the same reason: the timetable, the A/B shifts, the
 * bell schedule and the school breaks had outgrown a gear button in the
 * activities header, where nobody could find them. It sits right after
 * activities - the two answer the same question ("where does this child have
 * to be this week") and activities still draws the school blocks in its grid.
 *
 * The old keys still live in `profiles.nav_slots` rows and in per-device
 * "recent" storage, so {@link normalizeNavSlots} maps them forward in code -
 * deliberately no DB migration for something a pure function can absorb.
 */

export type NavSectionKey =
  | "today"
  | "calendar"
  | "money"
  | "tasks"
  | "activities"
  | "school"
  | "events"
  | "birthdays"
  | "family"
  | "settings";

export interface NavSection {
  key: NavSectionKey;
  to: string;
  /** Search params the link needs (family is a section of settings). */
  search?: Record<string, string>;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * All destinations in canonical (menu grid) order.
 *
 * Keys are English because they are persisted (`profiles.nav_slots`, the
 * per-device "recent" list) - only the labels are Serbian, so a future
 * localization pass never touches stored values.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  { key: "today", to: "/", label: "Danas", icon: SunIcon },
  { key: "calendar", to: "/calendar", label: "Kalendar", icon: CalendarDaysIcon },
  { key: "money", to: "/money", label: "Novac", icon: WalletIcon },
  { key: "tasks", to: "/tasks", label: "Zadaci", icon: ClipboardDocumentCheckIcon },
  { key: "activities", to: "/activities", label: "Aktivnosti", icon: SparklesIcon },
  { key: "school", to: "/school", label: "Škola", icon: AcademicCapIcon },
  { key: "events", to: "/events", label: "Događaji", icon: CalendarIcon },
  { key: "birthdays", to: "/birthdays", label: "Rođendani", icon: CakeIcon },
  {
    key: "family",
    to: "/settings",
    search: { tab: "family" },
    label: "Porodica",
    icon: UserGroupIcon,
  },
  { key: "settings", to: "/settings", label: "Podešavanja", icon: Cog6ToothIcon },
];

export const NAV_SECTION_MAP: Readonly<Record<NavSectionKey, NavSection>> = Object.fromEntries(
  NAV_SECTIONS.map((section) => [section.key, section]),
) as Record<NavSectionKey, NavSection>;

/**
 * What the menu sheet draws as tiles - everything except settings, which gets
 * its own full-width row under the grid.
 *
 * That is not a demotion, it is what keeps the grid readable: the tiles are a
 * 3-column grid, so the count has to stay a multiple of three or the last row
 * is one lonely tile. Settings is the right one to sit outside it - it is the
 * only section that cannot go in the bottom bar, it is already one tap away
 * through the avatar, and a settings row at the foot of a menu is where every
 * app puts it. Adding a tenth SECTION therefore costs nothing here; the next
 * one to be added is the one that needs a decision again.
 */
export const MENU_GRID_SECTIONS: readonly NavSection[] = NAV_SECTIONS.filter(
  (section) => section.key !== "settings",
);

/** Today is not up for grabs - always the first bottom-bar slot. */
export const FIXED_SECTION: NavSectionKey = "today";

/**
 * How many bottom-bar slots the user fills. Down from 3: the redesigned bar is
 * today - slot - [+] - slot - menu, so the centre "+" costs one slot.
 */
export const MAX_FREE_SLOTS = 2;

/** Layout for profiles that never customized (`nav_slots` NULL). */
export const DEFAULT_NAV_SLOTS: readonly NavSectionKey[] = ["calendar", "money"];

/**
 * Sections that may NOT be put in the bar. Settings is always one tap away
 * through the avatar and the menu sheet, so spending a slot on it is waste.
 */
export const UNSLOTTABLE_SECTIONS: readonly NavSectionKey[] = ["settings"];

/**
 * Pre-redesign keys, as they still sit in `profiles.nav_slots`. Mapped forward
 * on read so a returning user's bar keeps pointing at the same content: the
 * old upcoming page is now the calendar's agenda, and both payments and budget
 * are money.
 *
 * `lists` is the newest entry. Lists became Zadaci when list items grew a date,
 * and the key is persisted per profile AND in each device's "recent" list, so
 * without this line anybody who had put Liste in their bottom bar would find
 * that slot silently empty after the rename.
 */
const LEGACY_KEY_MAP: Readonly<Record<string, NavSectionKey>> = {
  danas: "today",
  uskoro: "calendar",
  payments: "money",
  budget: "money",
  lists: "tasks",
};

function isNavSectionKey(value: string): value is NavSectionKey {
  return value in NAV_SECTION_MAP;
}

/** Current key for a stored value, mapping legacy keys forward; null if unknown. */
export function resolveNavSectionKey(value: unknown): NavSectionKey | null {
  if (typeof value !== "string") return null;
  if (isNavSectionKey(value)) return value;
  return LEGACY_KEY_MAP[value] ?? null;
}

/**
 * Turn the raw `profiles.nav_slots` value into something the bar can render:
 * map legacy keys forward, drop unknown ones and the fixed today slot, dedupe
 * (both payments and budget collapse to money, so duplicates are expected),
 * cap at {@link MAX_FREE_SLOTS}. NULL/undefined means "never customized" and
 * falls back to the default layout; an empty array is a deliberate minimal bar
 * and stays empty.
 */
export function normalizeNavSlots(raw: readonly unknown[] | null | undefined): NavSectionKey[] {
  if (raw == null) return [...DEFAULT_NAV_SLOTS];
  const chosen = new Set<NavSectionKey>();
  for (const value of raw) {
    const key = resolveNavSectionKey(value);
    if (!key || key === FIXED_SECTION || UNSLOTTABLE_SECTIONS.includes(key)) continue;
    chosen.add(key);
    if (chosen.size === MAX_FREE_SLOTS) break;
  }
  return [...chosen];
}

/**
 * Which destination a pathname belongs to ("/tasks/123" -> tasks). Used to
 * record "recent" visits; null for routes outside the sections (login...).
 *
 * Family shares its pathname with settings (it is a section of it), so path
 * matching resolves to settings - family is only ever reached through an
 * explicit link.
 */
export function sectionForPathname(pathname: string): NavSectionKey | null {
  if (pathname === "/") return "today";
  for (const section of NAV_SECTIONS) {
    if (section.to === "/" || section.search) continue;
    if (pathname === section.to || pathname.startsWith(`${section.to}/`)) return section.key;
  }
  return null;
}

/** True when every search param the section links with is on the location. */
function searchMatches(section: NavSection, search: Record<string, unknown>): boolean {
  return Object.entries(section.search ?? {}).every(([key, value]) => search[key] === value);
}

/**
 * Whether a nav item is the one the current location belongs to - what every
 * surface (rail, bottom bar, menu grid) highlights.
 *
 * Family and settings share `/settings`, so the pathname alone can't tell them
 * apart: `?tab=family` is family's, and settings owns the hub plus every other
 * tab. Without that split, following the rail's own family link lit up
 * settings instead.
 */
export function isNavSectionActive(
  section: NavSection,
  pathname: string,
  search: Record<string, unknown>,
): boolean {
  if (section.to === "/") return pathname === "/";
  if (pathname !== section.to && !pathname.startsWith(`${section.to}/`)) return false;

  const siblings = NAV_SECTIONS.filter((other) => other.to === section.to);
  if (siblings.length < 2) return true;
  if (section.search) return searchMatches(section, search);
  // The plain section (settings) takes whatever none of its siblings claim.
  return !siblings.some((other) => other.search && searchMatches(other, search));
}
