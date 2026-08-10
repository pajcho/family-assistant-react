import type { ComponentType, SVGProps } from "react";
import {
  CalendarDaysIcon,
  ExclamationCircleIcon,
  InboxIcon,
  UserIcon,
} from "@heroicons/react/24/outline";

/**
 * The four cross-list views. They are selections over the caches the /tasks
 * screens already hold - no schema of their own, no query of their own - and they
 * all render through ONE screen component, because a smart list is a real list
 * with a different source: same header, same person rail, same day groups, same
 * composer.
 *
 * Each is a static route (`/tasks/scheduled`, not `/tasks/$listId` with a magic
 * id), so a deep-link stays readable and a list id can never collide with one.
 */

export type SmartListKey = "late" | "scheduled" | "mine" | "inbox";

export type SmartListDefinition = {
  key: SmartListKey;
  /**
   * The route to link to, spelled out as a literal so TanStack Router's typed
   * `to` accepts it - a template built from the key would widen to `string` and
   * lose the check that the route exists at all.
   */
  to: "/tasks/late" | "/tasks/scheduled" | "/tasks/mine" | "/tasks/inbox";
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
    subtitle: "Zadaci kojima je rok prošao, iz svih lista",
    icon: ExclamationCircleIcon,
    hideWhenEmpty: true,
  },
  {
    key: "scheduled",
    to: "/tasks/scheduled",
    label: "Zakazano",
    subtitle: "Svi zadaci sa datumom, iz svih lista",
    icon: CalendarDaysIcon,
    hideWhenEmpty: false,
  },
  {
    key: "mine",
    to: "/tasks/mine",
    label: "Meni dodeljeno",
    subtitle: "Zadaci koji su dodeljeni tebi",
    icon: UserIcon,
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
];

export function smartListDefinition(key: SmartListKey): SmartListDefinition {
  // Every key in the union has an entry, so the fallback only satisfies the
  // compiler - the list above is the single source of truth.
  return SMART_LISTS.find((entry) => entry.key === key) ?? SMART_LISTS[1];
}

/** How far ahead "Zakazano" looks. Three months of scheduled work is a screenful. */
export const SCHEDULED_WINDOW_DAYS = 90;
