import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENT_REMINDER_OPTIONS, ReminderSelect } from "@/components/ui/reminder-select";
import {
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { DateField } from "@/components/common/DateField";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import {
  ActivityForm,
  initialActivityFormState,
  type ActivityFormPayload,
  type ActivityFormState,
  type ActivityFormViewKind,
} from "@/components/activities/ActivityForm";
import { ActivityMoneySection } from "@/components/activities/ActivityMoneySection";
import type { Activity, ActivitySchedule, Profile } from "@/types/database";

export type ActivityFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity | null;
  /**
   * Add mode only - pre-fills the name (starter-chip "+ Trening" on the
   * empty state). Ignored while editing.
   */
  initialName?: string;
  existingRules?: ReadonlyArray<ActivitySchedule>;
  existingPersonIds?: ReadonlyArray<string>;
  people: ReadonlyArray<Profile>;
  peopleWithShift: ReadonlySet<string>;
  defaultPersonId?: string | null;
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ActivityFormPayload) => void;
};

type View = { kind: "form" | ActivityFormViewKind };

/**
 * The "Brzi unos" shell around <ActivityForm> - same architecture as
 * PaymentFormDialog: dialog-owned SheetStack (the mobile more-details row pushes
 * the Detalji sub-view into the same sheet), dialog-owned form state (so
 * a sub-view opening over the form keeps what was typed - including the whole
 * Termini rule list), reseed on open / entity / async-loaded rules or
 * participants, pinned mobile footer. Desktop renders fully expanded.
 *
 * When editing (and the dialog is open - the section fetches payments), the
 * read-only payments block is slotted into the form so linked payments and
 * the per-month attendance breakdown show up on the activity's own side of
 * the link. It renders nothing for activities without linked payments.
 */
export function ActivityFormDialog({
  open,
  onOpenChange,
  activity,
  initialName,
  existingRules,
  existingPersonIds,
  people,
  peopleWithShift,
  defaultPersonId,
  error,
  saving,
  onSubmit,
}: ActivityFormDialogProps) {
  const fallbackPersonId = defaultPersonId ?? people[0]?.id ?? "";
  const stack = useSheetStack<View>(open, onOpenChange, { kind: "form" });
  const seedName = activity ? undefined : initialName;
  const [form, setForm] = useState<ActivityFormState>(() => ({
    ...initialActivityFormState(activity, existingRules, existingPersonIds, fallbackPersonId),
    ...(seedName ? { name: seedName } : null),
  }));
  const { reset: resetStack } = stack;

  // Reseed on every open, and while open whenever the edited activity (or
  // its async-loaded rules / participants) changes - same semantics the form
  // had when it owned the state.
  useEffect(() => {
    if (!open) return;
    setForm({
      ...initialActivityFormState(activity, existingRules, existingPersonIds, fallbackPersonId),
      ...(activity ? null : initialName ? { name: initialName } : null),
    });
    resetStack();
  }, [open, activity, initialName, existingRules, existingPersonIds, fallbackPersonId, resetStack]);

  const title = activity ? "Izmeni aktivnost" : "Dodaj aktivnost";
  const isDesktop = useIsDesktop();

  const mobileFooterFor = (view: View) =>
    !isDesktop && view.kind === "form" ? (
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          Odustani
        </Button>
        <Button type="submit" form="activity-form" disabled={saving} className="flex-1">
          {activity ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    ) : undefined;

  return (
    <SheetStackViews
      stack={stack}
      render={(view) => (
        <ResponsiveDialogContent className="sm:max-w-2xl" stickyFooter={mobileFooterFor(view)}>
          {view.kind === "form" ? (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
              </ResponsiveDialogHeader>
              {error ? (
                <div className="mb-4 rounded-lg bg-neg-soft p-3 text-sm font-normal text-neg">
                  {error}
                </div>
              ) : null}
              <ActivityForm
                form={form}
                setForm={setForm}
                activity={activity}
                peopleWithShift={peopleWithShift}
                saving={saving}
                paymentsSection={
                  activity && open ? <ActivityMoneySection activity={activity} /> : undefined
                }
                onSubmit={onSubmit}
                onCancel={() => onOpenChange(false)}
                onOpenView={(kind) => stack.push({ kind })}
              />
            </>
          ) : (
            <>
              <SheetStackHeader title="Detalji" onBack={stack.pop} />
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="description">Opis</Label>
                  <Input
                    id="description"
                    value={form.description}
                    onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
                    placeholder="dodatni detalji (opciono)"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sezona (od / do)</Label>
                  <DateField
                    id="active_from"
                    label="Od"
                    value={form.active_from}
                    onChange={(value) => setForm((s) => ({ ...s, active_from: value }))}
                    placeholder="npr. 1. septembar"
                    clearable
                  />
                  <DateField
                    id="active_to"
                    label="Do"
                    value={form.active_to}
                    onChange={(value) => setForm((s) => ({ ...s, active_to: value }))}
                    placeholder="npr. 15. jun"
                    minDate={form.active_from}
                    clearable
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="activity-reminder">Podsetnik</Label>
                  <ReminderSelect
                    id="activity-reminder"
                    value={form.remind_minutes_before}
                    onChange={(value) => setForm((s) => ({ ...s, remind_minutes_before: value }))}
                    options={EVENT_REMINDER_OPTIONS}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Svaki učesnik dobija push obaveštenje. Otkazani i pomereni termini se preskaču.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Beleške</Label>
                  <Input
                    id="notes"
                    value={form.notes}
                    onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                    placeholder="lokacija, trener, itd."
                  />
                </div>
              </div>
            </>
          )}
        </ResponsiveDialogContent>
      )}
    />
  );
}
