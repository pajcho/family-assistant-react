import { useEffect, useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/cn";
import type { Profile, SchoolShift, SchoolShiftAnchor } from "@/types/database";
import { SHIFT_LABELS, getThisWeekStart, getWeekStart } from "@/utils/activity";
import { useDeleteSchoolShiftAnchor, useUpsertSchoolShiftAnchor } from "@/hooks/useSchoolShifts";

export type ShiftSetupFormProps = {
  member: Profile;
  anchor: SchoolShiftAnchor | undefined;
  /** Called after a successful save or remove — typically closes the dialog. */
  onClose?: () => void;
};

/**
 * The school-shift setup form for one child: anchor week + shift, plus the
 * two independent toggles (A/B rotation, fixed morning band) and the pred-čas
 * option. Self-contained — owns its save + remove mutations.
 *
 * Remove uses an inline two-step confirm (not a separate dialog) so it can
 * live safely inside another dialog/drawer without nested overlays.
 */
export function ShiftSetupForm({ member, anchor, onClose }: ShiftSetupFormProps) {
  const upsert = useUpsertSchoolShiftAnchor();
  const deleteAnchor = useDeleteSchoolShiftAnchor();

  // Defaults: week = current week (so the date is useful as-is), shift = null
  // when no anchor exists yet — preselecting a shift would imply the child is
  // already in it.
  const [weekStart, setWeekStart] = useState<string | null>(
    anchor?.anchor_week_start ?? getThisWeekStart(),
  );
  const [shift, setShift] = useState<SchoolShift | null>(anchor?.anchor_shift ?? null);
  const [isAlternating, setIsAlternating] = useState<boolean>(anchor?.is_alternating ?? true);
  // 1st/2nd grade: time of day pinned to morning, while the A/B subject rota
  // (above) keeps flipping. Independent of `isAlternating`.
  const [fixedMorning, setFixedMorning] = useState<boolean>(anchor?.fixed_time_band === "morning");
  const [usesPredcas, setUsesPredcas] = useState<boolean>(anchor?.afternoon_uses_predcas ?? true);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    setWeekStart(anchor?.anchor_week_start ?? getThisWeekStart());
    setShift(anchor?.anchor_shift ?? null);
    setIsAlternating(anchor?.is_alternating ?? true);
    setFixedMorning(anchor?.fixed_time_band === "morning");
    setUsesPredcas(anchor?.afternoon_uses_predcas ?? true);
    setConfirmingRemove(false);
  }, [anchor]);

  const handleSave = async () => {
    if (!weekStart || !shift) return;
    const normalized = getWeekStart(weekStart);
    try {
      await upsert.mutateAsync({
        person_id: member.id,
        anchor_week_start: normalized,
        anchor_shift: shift,
        flip_interval_weeks: 1,
        is_alternating: isAlternating,
        fixed_time_band: fixedMorning ? "morning" : null,
        afternoon_uses_predcas: usesPredcas,
      });
      toast.success("Smena sačuvana");
      onClose?.();
    } catch {
      // Error toast handled by the mutation hook.
    }
  };

  const handleRemove = async () => {
    try {
      await deleteAnchor.mutateAsync(member.id);
      toast.success("Smena uklonjena");
      onClose?.();
    } catch {
      // Error toast handled by the mutation hook.
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {fixedMorning
          ? "Dete je uvek u jutarnjoj smeni, ali se raspored i dalje smenjuje po nedeljama (A/B). Smena te nedelje samo bira koja je nedelja A, a koja B."
          : isAlternating
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
          Raspored se menja po nedeljama (A/B)
          <span className="block text-[11px] text-muted-foreground">
            Isključi samo ako dete ima isti raspored svake nedelje.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={fixedMorning}
          onChange={(e) => setFixedMorning(e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span className="text-xs text-gray-700 dark:text-gray-200">
          Uvek u jutarnjoj smeni (1. i 2. razred)
          <span className="block text-[11px] text-muted-foreground">
            Vreme je uvek ujutru; raspored se i dalje smenjuje ako je gore uključeno.
          </span>
        </span>
      </label>
      {!fixedMorning ? (
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={usesPredcas}
            onChange={(e) => setUsesPredcas(e.target.checked)}
            className="mt-0.5 rounded border-gray-300"
          />
          <span className="text-xs text-gray-700 dark:text-gray-200">
            Popodne počinje u 13h (pred-čas)
            <span className="block text-[11px] text-muted-foreground">
              Veliki odmor tek posle 3. časa.
            </span>
          </span>
        </label>
      ) : null}

      {confirmingRemove ? (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-2.5 dark:border-red-900/40 dark:bg-red-950/20">
          <p className="text-xs text-red-700 dark:text-red-300">
            Ukloniti smenu? Raspored časova ostaje sačuvan i ponovo se prikazuje kad opet postaviš
            smenu.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingRemove(false)}
              disabled={deleteAnchor.isPending}
            >
              Odustani
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void handleRemove()}
              disabled={deleteAnchor.isPending}
            >
              Ukloni smenu
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          {anchor ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={() => setConfirmingRemove(true)}
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
            onClick={() => void handleSave()}
            disabled={upsert.isPending || !weekStart || !shift}
          >
            Sačuvaj
          </Button>
        </div>
      )}
    </div>
  );
}
