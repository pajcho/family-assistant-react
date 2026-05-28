import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import type { Profile, SchoolShift } from "@/types/database";
import { SHIFT_LABELS, fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";

export type PersonChipProps = {
  person: Profile;
  active: boolean;
  onToggle: () => void;
  /**
   * Resolved time band for the displayed week, if the person is in school.
   * Shown as a small sun/moon so the shift stays glanceable now that the
   * separate shift-card row lives in the options sheet.
   */
  shift?: SchoolShift | null;
};

/**
 * Filter chip in the activities page header. The dot on the left is the
 * person's color (falls back to a deterministic palette slot when unset).
 * Clicking the chip toggles whether that person's activities show in the
 * grid; an "active" chip has a tinted background. A trailing sun/moon marks
 * the morning/afternoon shift for the week when known.
 */
export function PersonChip({ person, active, onToggle, shift }: PersonChipProps) {
  const color = person.color ?? fallbackColorForProfile(person.id);
  const name =
    getDisplayName({
      firstName: person.first_name,
      lastName: person.last_name,
      email: null,
    }) || "Bez imena";

  return (
    <button
      type="button"
      onClick={onToggle}
      style={
        active
          ? {
              backgroundColor: `${color}1F`,
              borderColor: color,
            }
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        active
          ? "text-gray-900 dark:text-gray-100"
          : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
      )}
      aria-pressed={active}
    >
      <span
        className="inline-block size-2.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="truncate">{name}</span>
      {shift ? (
        <span
          className="text-muted-foreground"
          title={SHIFT_LABELS[shift]}
          aria-label={SHIFT_LABELS[shift]}
        >
          {shift === "morning" ? (
            <SunIcon className="h-3.5 w-3.5" />
          ) : (
            <MoonIcon className="h-3.5 w-3.5" />
          )}
        </span>
      ) : null}
    </button>
  );
}
