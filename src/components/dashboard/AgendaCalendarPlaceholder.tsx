import { CalendarDaysIcon } from "@heroicons/react/24/outline";

/**
 * Temporary stand-in for the calendar view while the toggle scaffold lands
 * (Phase 4 PR 3). The single-day (Danas) and weekly timetable (Uskoro) calendars
 * replace this in PR 4 / PR 5. `label` names which calendar is coming.
 */
export function AgendaCalendarPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white/50 px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800/30">
      <CalendarDaysIcon className="size-10 text-gray-400 dark:text-gray-500" />
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Uskoro.</p>
      </div>
    </div>
  );
}
