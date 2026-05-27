import * as React from "react";
import { AcademicCapIcon, TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/cn";
import type { Profile, SchoolShift, SchoolShiftAnchor } from "@/types/database";
import {
  SHIFT_LABELS,
  fallbackColorForProfile,
  getThisWeekStart,
  getWeekStart,
} from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import {
  useDeleteSchoolShiftAnchor,
  useUpsertSchoolShiftAnchor,
} from "@/hooks/useSchoolShifts";

export type ShiftControlsProps = {
  members: ReadonlyArray<Profile>;
  anchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  /** Shift derived for the currently displayed week (one per person with anchor). */
  shiftsByPerson: ReadonlyMap<string, SchoolShift>;
};

/**
 * One small card per family member showing their current school shift, with
 * a popover to set/change the anchor. Members without an anchor get a
 * "Postavi smenu" CTA instead.
 *
 * The whole row is collapsed by default if no member has a shift yet — keeps
 * the page minimal for non-school cases.
 */
export function ShiftControls({ members, anchorsByPersonId, shiftsByPerson }: ShiftControlsProps) {
  // Hide the whole strip when nobody has a shift yet AND there are no
  // members. (Once at least one member exists, we always show the strip so
  // the user can actually create the first anchor.)
  if (members.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {members.map((member) => {
        const anchor = anchorsByPersonId.get(member.id);
        const currentShift = shiftsByPerson.get(member.id) ?? null;
        return (
          <ShiftCard
            key={member.id}
            member={member}
            anchor={anchor}
            currentShift={currentShift}
          />
        );
      })}
    </div>
  );
}

interface ShiftCardProps {
  member: Profile;
  anchor: SchoolShiftAnchor | undefined;
  currentShift: SchoolShift | null;
}

function ShiftCard({ member, anchor, currentShift }: ShiftCardProps) {
  const color = member.color ?? fallbackColorForProfile(member.id);
  const name =
    getDisplayName({
      firstName: member.first_name,
      lastName: member.last_name,
      email: null,
    }) || "Bez imena";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5",
            "text-left text-sm shadow-xs transition-colors hover:bg-gray-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            "dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700",
          )}
        >
          <AcademicCapIcon className="h-4 w-4 text-muted-foreground" />
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{name}</span>
          {currentShift ? (
            <span className="text-xs text-muted-foreground">{SHIFT_LABELS[currentShift]}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <ShiftSetupForm member={member} anchor={anchor} />
      </PopoverContent>
    </Popover>
  );
}

interface ShiftSetupFormProps {
  member: Profile;
  anchor: SchoolShiftAnchor | undefined;
}

function ShiftSetupForm({ member, anchor }: ShiftSetupFormProps) {
  const upsert = useUpsertSchoolShiftAnchor();
  const deleteAnchor = useDeleteSchoolShiftAnchor();

  // Defaults: week = current week (so the date is useful as-is), shift =
  // null when no anchor exists yet. Preselecting "morning" misleads the
  // user into thinking the kid is already in that shift — they aren't,
  // it's the first-time setup. They have to pick explicitly.
  const [weekStart, setWeekStart] = React.useState<string | null>(
    anchor?.anchor_week_start ?? getThisWeekStart(),
  );
  const [shift, setShift] = React.useState<SchoolShift | null>(anchor?.anchor_shift ?? null);
  const [isAlternating, setIsAlternating] = React.useState<boolean>(
    anchor?.is_alternating ?? true,
  );

  React.useEffect(() => {
    setWeekStart(anchor?.anchor_week_start ?? getThisWeekStart());
    setShift(anchor?.anchor_shift ?? null);
    setIsAlternating(anchor?.is_alternating ?? true);
  }, [anchor]);

  const handleSave = () => {
    if (!weekStart || !shift) return;
    // Normalize to Monday before sending — the user might pick any day in
    // the date picker.
    const normalized = getWeekStart(weekStart);
    void upsert.mutateAsync({
      person_id: member.id,
      anchor_week_start: normalized,
      anchor_shift: shift,
      flip_interval_weeks: 1,
      is_alternating: isAlternating,
    });
  };

  const handleRemove = () => {
    void deleteAnchor.mutateAsync(member.id);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {isAlternating
          ? "Postavi nedelju i smenu — sve ostalo se računa automatski (smena se naizmenice menja svake nedelje)."
          : "Postavi smenu u kojoj dete uvek ostaje. Nedelja se koristi samo kao polazna tačka."}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`anchor-week-${member.id}`}>Nedelja</Label>
        <DatePicker
          id={`anchor-week-${member.id}`}
          value={weekStart}
          onChange={setWeekStart}
          placeholder="Bilo koji dan u toj nedelji"
        />
      </div>
      <div className="space-y-1.5">
        <Label>{isAlternating ? "Smena te nedelje" : "Smena"}</Label>
        <div className="flex gap-2">
          {(["morning", "afternoon"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setShift(option)}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                shift === option
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                  : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800",
              )}
            >
              {SHIFT_LABELS[option]}
            </button>
          ))}
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={isAlternating}
          onChange={(e) => setIsAlternating(e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span className="text-xs text-gray-700 dark:text-gray-200">
          Smena se naizmenice menja
          <span className="block text-[11px] text-muted-foreground">
            Isključi za prvi i drugi razred — uvek su u istoj smeni.
          </span>
        </span>
      </label>
      <div className="flex items-center justify-between gap-2">
        {anchor ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700"
            onClick={handleRemove}
            disabled={deleteAnchor.isPending}
          >
            <TrashIcon className="mr-1 h-4 w-4" />
            Ukloni
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={upsert.isPending || !weekStart || !shift}
        >
          Sačuvaj
        </Button>
      </div>
    </div>
  );
}
