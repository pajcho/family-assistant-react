import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import {
  EventForm,
  initialEventFormState,
  type EventFormDefaults,
  type EventFormPayload,
  type EventFormState,
  type EventFormViewKind,
} from "@/components/events/EventForm";
import type { Event } from "@/types/database";
import { useToday } from "@/hooks/useToday";

export type EventFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  /** Assignees of the event being edited; empty/omitted when adding. */
  initialPersonIds?: string[];
  /** ADD-mode prefill (e.g. "Organizuj proslavu") — see EventFormDefaults. */
  defaults?: EventFormDefaults;
  /** Dialog title override; falls back to Dodaj/Izmeni događaj. */
  title?: string;
  /** Inline error banner shown above the form (e.g. mutation failure). */
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: EventFormPayload) => void;
};

type View = { kind: "form" | EventFormViewKind };

/**
 * The "Brzi unos" shell around <EventForm> — same architecture as
 * PaymentFormDialog: dialog-owned SheetStack (mobile "Više detalja" pushes
 * the Detalji sub-view into the same sheet), dialog-owned form state (so the
 * mobile close→reopen hop keeps what was typed), reseed on open / entity /
 * defaults change, pinned mobile footer. Desktop renders fully expanded.
 */
export function EventFormDialog({
  open,
  onOpenChange,
  event,
  initialPersonIds,
  defaults,
  title: titleOverride,
  error,
  saving,
  onSubmit,
}: EventFormDialogProps) {
  const today = useToday();
  const stack = useSheetStack<View>(open, onOpenChange, { kind: "form" });
  const [form, setForm] = useState<EventFormState>(() =>
    initialEventFormState(event, initialPersonIds ?? [], defaults, today.str),
  );
  const { reset: resetStack } = stack;

  // Serialized so the effect reseeds when the assignees finish loading /
  // defaults change identity without firing on fresh references.
  const personSeed = (initialPersonIds ?? []).join(",");
  const defaultsSeed = defaults ? JSON.stringify(defaults) : "";
  // Read through a ref so a midnight rollover doesn't wipe a form mid-typing.
  const todayRef = useRef(today.str);
  todayRef.current = today.str;

  useEffect(() => {
    if (!open) return;
    setForm(
      initialEventFormState(
        event,
        personSeed ? personSeed.split(",") : [],
        defaultsSeed ? (JSON.parse(defaultsSeed) as EventFormDefaults) : undefined,
        todayRef.current,
      ),
    );
    resetStack();
  }, [open, event, personSeed, defaultsSeed, resetStack]);

  const title = titleOverride ?? (event ? "Izmeni događaj" : "Dodaj događaj");
  const view = stack.view;
  const isDesktop = useIsDesktop();

  const mobileFooter =
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
        <Button type="submit" form="event-form" disabled={saving} className="flex-1">
          {event ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    ) : undefined;

  return (
    <ResponsiveDialog
      key={stack.dialogKey}
      open={stack.dialogOpen}
      onOpenChange={stack.handleOpenChange}
    >
      <ResponsiveDialogContent stickyFooter={mobileFooter}>
        {view.kind === "form" ? (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            {error ? (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            ) : null}
            <EventForm
              form={form}
              setForm={setForm}
              event={event}
              saving={saving}
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
                  placeholder="detalji događaja"
                />
              </div>
              <MemberMultiSelect
                label="Za koga (opciono)"
                value={form.personIds}
                onChange={(personIds) => setForm((s) => ({ ...s, personIds }))}
              />
              <div className="space-y-2">
                <Label htmlFor="notes">Napomene (poklon, itd.)</Label>
                <Input
                  id="notes"
                  value={form.notes}
                  onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                  placeholder="npr. Kupljena knjiga, ostalo za pakovanje"
                />
              </div>
            </div>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
