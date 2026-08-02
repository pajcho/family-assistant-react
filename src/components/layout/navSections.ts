import type { ComponentType, SVGProps } from "react";
import {
  BanknotesIcon,
  CakeIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  HomeIcon,
  Squares2X2Icon,
  WalletIcon,
} from "@heroicons/react/24/outline";

/**
 * Single source of truth for the app's nine navigation destinations: the
 * desktop top row, the mobile bottom bar and the "Meni" sheet all render from
 * this list, so a new section is added exactly once.
 *
 * Tile accents follow the app's per-type convention (activity violet, event
 * blue, budget emerald, birthday pink, payment amber - the same amber as the
 * agenda cards; settings neutral). Danas gets sky so it doesn't read as a
 * duplicate of the event blue in the sheet grid.
 */

export type NavSectionKey =
  | "danas"
  | "uskoro"
  | "activities"
  | "events"
  | "payments"
  | "budget"
  | "lists"
  | "birthdays"
  | "settings";

export interface NavSection {
  key: NavSectionKey;
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Tile icon foreground, e.g. in the "Meni" sheet grid. */
  iconClass: string;
  /** Tile icon circle background. */
  iconBgClass: string;
}

/** All destinations in canonical (grid) order. */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: "danas",
    to: "/",
    label: "Danas",
    icon: HomeIcon,
    iconClass: "text-sky-600 dark:text-sky-400",
    iconBgClass: "bg-sky-100 dark:bg-sky-900/40",
  },
  {
    key: "uskoro",
    to: "/uskoro",
    label: "Uskoro",
    icon: CalendarDaysIcon,
    iconClass: "text-indigo-600 dark:text-indigo-400",
    iconBgClass: "bg-indigo-100 dark:bg-indigo-900/40",
  },
  {
    key: "activities",
    to: "/activities",
    label: "Aktivnosti",
    icon: Squares2X2Icon,
    iconClass: "text-violet-600 dark:text-violet-400",
    iconBgClass: "bg-violet-100 dark:bg-violet-900/40",
  },
  {
    key: "events",
    to: "/events",
    label: "Događaji",
    icon: CalendarIcon,
    iconClass: "text-blue-600 dark:text-blue-400",
    iconBgClass: "bg-blue-100 dark:bg-blue-900/40",
  },
  {
    key: "payments",
    to: "/payments",
    label: "Plaćanja",
    icon: BanknotesIcon,
    iconClass: "text-amber-600 dark:text-amber-400",
    iconBgClass: "bg-amber-100 dark:bg-amber-900/40",
  },
  {
    key: "budget",
    to: "/budget",
    label: "Budžet",
    icon: WalletIcon,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    iconBgClass: "bg-emerald-100 dark:bg-emerald-900/40",
  },
  {
    key: "lists",
    to: "/lists",
    label: "Liste",
    icon: ClipboardDocumentListIcon,
    iconClass: "text-teal-600 dark:text-teal-400",
    iconBgClass: "bg-teal-100 dark:bg-teal-900/40",
  },
  {
    key: "birthdays",
    to: "/birthdays",
    label: "Rođendani",
    icon: CakeIcon,
    iconClass: "text-pink-600 dark:text-pink-400",
    iconBgClass: "bg-pink-100 dark:bg-pink-900/40",
  },
  {
    key: "settings",
    to: "/settings",
    label: "Podešavanja",
    icon: Cog6ToothIcon,
    iconClass: "text-gray-600 dark:text-gray-300",
    iconBgClass: "bg-gray-100 dark:bg-gray-700",
  },
];

export const NAV_SECTION_MAP: Readonly<Record<NavSectionKey, NavSection>> = Object.fromEntries(
  NAV_SECTIONS.map((section) => [section.key, section]),
) as Record<NavSectionKey, NavSection>;

/** Desktop top row: everything except Podešavanja (that lives in the avatar menu). */
export const DESKTOP_SECTIONS: readonly NavSection[] = NAV_SECTIONS.filter(
  (section) => section.key !== "settings",
);

/** "Danas" is not up for grabs - always the first bottom-bar slot. */
export const FIXED_SECTION: NavSectionKey = "danas";

/** How many bottom-bar slots the user fills (the fifth is the "Meni" trigger). */
export const MAX_FREE_SLOTS = 3;

/** Layout for profiles that never customized (`nav_slots` NULL). */
export const DEFAULT_NAV_SLOTS: readonly NavSectionKey[] = ["uskoro", "payments", "lists"];

function isNavSectionKey(value: string): value is NavSectionKey {
  return value in NAV_SECTION_MAP;
}

/**
 * Turn the raw `profiles.nav_slots` value into something the bar can render:
 * drop unknown keys and the fixed "danas", dedupe, cap at {@link MAX_FREE_SLOTS}.
 * NULL/undefined means "never customized" and falls back to the default
 * layout; an empty array is a deliberate minimal bar and stays empty.
 */
export function normalizeNavSlots(raw: readonly unknown[] | null | undefined): NavSectionKey[] {
  if (raw == null) return [...DEFAULT_NAV_SLOTS];
  const chosen = new Set<NavSectionKey>();
  for (const value of raw) {
    if (typeof value !== "string" || !isNavSectionKey(value) || value === FIXED_SECTION) continue;
    chosen.add(value);
    if (chosen.size === MAX_FREE_SLOTS) break;
  }
  return [...chosen];
}

/**
 * Which destination a pathname belongs to ("/payments/123" → payments).
 * Used to record "Nedavno" visits; null for routes outside the nine (login…).
 */
export function sectionForPathname(pathname: string): NavSectionKey | null {
  if (pathname === "/") return "danas";
  for (const section of NAV_SECTIONS) {
    if (section.to === "/") continue;
    if (pathname === section.to || pathname.startsWith(`${section.to}/`)) return section.key;
  }
  return null;
}
