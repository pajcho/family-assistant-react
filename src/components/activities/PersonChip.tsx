import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";

import { FilterChip } from "@/components/common/FilterChips";
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
 * Family-member filter chip. The dot on the left is the person's colour (with
 * a deterministic palette fallback when unset), and an active chip tints with
 * that same colour - the app's oldest visual convention, kept through the
 * redesign because a member reads faster by colour than by name.
 *
 * Built on the shared {@link FilterChip} so it is the same pill shape and the
 * same 44px tap target as every other filter on the screen.
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
    <FilterChip active={active} onToggle={onToggle} color={color}>
      <span className="truncate">{name}</span>
      {shift ? (
        <span title={SHIFT_LABELS[shift]} aria-label={SHIFT_LABELS[shift]}>
          {shift === "morning" ? (
            <SunIcon className="size-3.5" />
          ) : (
            <MoonIcon className="size-3.5" />
          )}
        </span>
      ) : null}
    </FilterChip>
  );
}
