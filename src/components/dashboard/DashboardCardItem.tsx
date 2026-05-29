import type { ComponentType, SVGProps } from "react";

import { cn } from "@/lib/cn";
import type { DashboardItemAccent } from "@/components/dashboard/DashboardCard";

/**
 * Per-accent row tint + value text colour. `red` is reserved for overdue
 * payment rows (the only place where a row tint disagrees with the card's
 * own accent). Mirrors `components/dashboard/DashboardCardItem.vue`.
 */
const ROW_BG: Record<DashboardItemAccent, string> = {
  blue: "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/10 dark:hover:bg-blue-900/30",
  amber: "bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/10 dark:hover:bg-amber-900/30",
  emerald: "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/30",
  purple: "bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/10 dark:hover:bg-purple-900/30",
  red: "bg-red-50 hover:bg-red-100 dark:bg-red-900/10 dark:hover:bg-red-900/30",
};

const VALUE_TEXT: Record<DashboardItemAccent, string> = {
  blue: "text-blue-700 dark:text-blue-400",
  amber: "text-amber-700 dark:text-amber-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  purple: "text-purple-700 dark:text-purple-400",
  red: "text-red-700 dark:text-red-400",
};

const BADGE_ICON_COLOR: Record<DashboardItemAccent, string> = {
  blue: "text-gray-500 dark:text-gray-400",
  amber: "text-gray-500 dark:text-gray-400",
  emerald: "text-gray-500 dark:text-gray-400",
  purple: "text-gray-500 dark:text-gray-400",
  red: "text-red-600 dark:text-red-400",
};

export type DashboardCardItemProps = {
  label: string;
  value: string;
  /** Optional inline description rendered after the label in a muted color. */
  description?: string;
  /** Accent palette for the row tint + value text. Defaults to `blue`. */
  accent?: DashboardItemAccent;
  /** Optional badge icon (e.g. overdue triangle) rendered after the label. */
  badgeIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  badgeIconTitle?: string;
  /** Strikethrough / dim the whole row (used for completed events). */
  completed?: boolean;
  onClick: () => void;
};

/**
 * A clickable row inside a `DashboardCard`. Direct port of
 * `components/dashboard/DashboardCardItem.vue`.
 *
 * The whole row is a `<button>` so the dashboard's detail-popup pattern can
 * just listen for `onClick` without needing a wrapper anchor.
 */
export function DashboardCardItem({
  label,
  value,
  description,
  accent = "blue",
  badgeIcon: BadgeIcon,
  badgeIconTitle,
  completed = false,
  onClick,
}: DashboardCardItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // items-start (not items-center) so the right-side value aligns
        // with the title even when the description wraps to a second
        // line. `min-w-0` on the parent so children can shrink and
        // wrap instead of pushing the row past the viewport.
        "flex w-full min-w-0 items-start justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
        ROW_BG[accent],
        completed && "opacity-50",
      )}
    >
      <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", completed && "opacity-50")}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 font-medium break-words text-gray-900 dark:text-gray-100">
            {label}
          </span>
          {BadgeIcon ? (
            <span className={cn("shrink-0", BADGE_ICON_COLOR[accent])} title={badgeIconTitle}>
              <BadgeIcon className="h-4 w-4" />
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="text-xs break-words text-gray-500 dark:text-gray-400">
            {description}
          </span>
        ) : null}
      </span>
      <span
        className={cn("shrink-0 whitespace-nowrap", VALUE_TEXT[accent], completed && "opacity-50")}
      >
        {value}
      </span>
    </button>
  );
}
