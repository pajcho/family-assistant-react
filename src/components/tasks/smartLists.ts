import type { ComponentType, SVGProps } from "react";
import {
  CalendarDaysIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  InboxIcon,
} from "@heroicons/react/24/outline";

/**
 * The four cross-list views: what is late, what is scheduled, what belongs to no
 * list, and what is already done. They are selections over the caches the /tasks
 * screens already hold - no schema of their own, no query of their own - and the
 * first three render through ONE screen component, because a smart list is a
 * real list with a different source: same header, same person rail, same day
 * groups, same composer. Završeno is the exception: it groups by the day a task
 * was TICKED rather than the day it was due, so it is its own screen.
 *
 * Each is a static route (`/tasks/scheduled`, not `/tasks/$listId` with a magic
 * id), so a deep-link stays readable and a list id can never collide with one.
 *
 * There used to be a fifth, "Meni dodeljeno". It was dropped in 2026-08: every
 * one of these views already carries a person rail, so "assigned to me" was one
 * chip on any of them rather than a view of its own, and four cuts is what fits
 * the mobile tile grid.
 */

export type SmartListKey = "late" | "scheduled" | "inbox" | "done";

export type SmartListDefinition = {
  key: SmartListKey;
  /**
   * The route to link to, spelled out as a literal so TanStack Router's typed
   * `to` accepts it - a template built from the key would widen to `string` and
   * lose the check that the route exists at all.
   */
  to: "/tasks/late" | "/tasks/scheduled" | "/tasks/inbox" | "/tasks/done";
  label: string;
  /** The sub-line under the title: what this view actually contains. */
  subtitle: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * Hide the row when the count is zero. Only Kasni does: an empty Kasni is good
   * news, and a permanent red 0 in the sidebar stops meaning anything.
   */
  hideWhenEmpty: boolean;
};

export const SMART_LISTS: ReadonlyArray<SmartListDefinition> = [
  {
    key: "late",
    to: "/tasks/late",
    label: "Kasni",
    subtitle: "Prošao rok, i propušteni dani ponavljanja",
    icon: ExclamationCircleIcon,
    hideWhenEmpty: true,
  },
  {
    key: "scheduled",
    to: "/tasks/scheduled",
    label: "Zakazano",
    subtitle: "Zadaci sa datumom, za naredna 3 meseca",
    icon: CalendarDaysIcon,
    hideWhenEmpty: false,
  },
  {
    key: "inbox",
    to: "/tasks/inbox",
    label: "Inbox",
    subtitle: "Zadaci koji ne pripadaju nijednoj listi",
    icon: InboxIcon,
    hideWhenEmpty: false,
  },
  {
    key: "done",
    to: "/tasks/done",
    label: "Završeno",
    subtitle: "Šta je urađeno, po danu kada je štiklirano",
    icon: CheckCircleIcon,
    hideWhenEmpty: false,
  },
];

/**
 * How far back "Završeno" looks. A month answers "what did we get done" without
 * turning into an archive nobody scrolls - and it is the same window the tile's
 * count uses, so the number and the screen can never disagree.
 */
export const COMPLETED_WINDOW_DAYS = 30;

export function smartListDefinition(key: SmartListKey): SmartListDefinition {
  // Every key in the union has an entry, so the fallback only satisfies the
  // compiler - the list above is the single source of truth.
  return SMART_LISTS.find((entry) => entry.key === key) ?? SMART_LISTS[1];
}

/** How far ahead "Zakazano" looks. Three months of scheduled work is a screenful. */
export const SCHEDULED_WINDOW_DAYS = 90;
