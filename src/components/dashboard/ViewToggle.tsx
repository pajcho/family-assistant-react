import { CalendarDaysIcon, ListBulletIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import type { AgendaView } from "@/hooks/useAgendaView";

/**
 * List ↔ calendar segmented toggle, shown top-right of a dashboard page. Drives
 * the per-page `useAgendaView` preference. Icon + label on sm+, icon-only on the
 * narrowest screens — `sr-only` (not `hidden`, which would drop the text from
 * the accessibility tree) keeps the label available to assistive tech there.
 */
const SEGMENT_CLASS =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset";
const ACTIVE_CLASS = "bg-blue-600 text-white dark:bg-blue-500";
const INACTIVE_CLASS =
  "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60";

export function ViewToggle({
  value,
  onChange,
}: {
  value: AgendaView;
  onChange: (view: AgendaView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Prikaz"
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800"
    >
      <button
        type="button"
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
        className={cn(SEGMENT_CLASS, value === "list" ? ACTIVE_CLASS : INACTIVE_CLASS)}
      >
        <ListBulletIcon className="size-4 shrink-0" />
        <span className="sr-only sm:not-sr-only">Lista</span>
      </button>
      <button
        type="button"
        aria-pressed={value === "calendar"}
        onClick={() => onChange("calendar")}
        className={cn(
          SEGMENT_CLASS,
          "border-l border-gray-200 dark:border-gray-700",
          value === "calendar" ? ACTIVE_CLASS : INACTIVE_CLASS,
        )}
      >
        <CalendarDaysIcon className="size-4 shrink-0" />
        <span className="sr-only sm:not-sr-only">Kalendar</span>
      </button>
    </div>
  );
}
