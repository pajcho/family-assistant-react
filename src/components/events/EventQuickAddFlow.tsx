import { useState } from "react";
import { toast } from "sonner";

import { EventFormDialog } from "@/components/events/EventFormDialog";
import type { EventFormPayload } from "@/components/events/EventForm";
import { useCreateEvent } from "@/hooks/useEvents";

export type EventQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Add -> event from surfaces that don't own the events mutations (the
 * global "+" in the bottom bar). Same shape as `ExpenseQuickAddFlow`: owns the
 * create mutation and the inline error, never navigates - whatever screen you
 * were on, you stay on it.
 *
 * Add only. Editing keeps living on the page that owns the event, because that
 * is where the prefill (participants) and the delete action already are.
 */
export function EventQuickAddFlow({ open, onOpenChange }: EventQuickAddFlowProps) {
  const createEvent = useCreateEvent();
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setFormError(null);
  };

  const handleSubmit = async (payload: EventFormPayload) => {
    setFormError(null);
    try {
      await createEvent.mutateAsync(payload);
      onOpenChange(false);
      // The flow never navigates, so without this the sheet just vanishes and
      // nothing on screen says the event exists (same reason as the expense).
      toast.success("Događaj je dodat.");
    } catch (err) {
      setFormError(
        err instanceof Error && err.message ? err.message : "Greška pri kreiranju događaja",
      );
    }
  };

  return (
    <EventFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      event={null}
      initialPersonIds={[]}
      error={formError}
      saving={createEvent.isPending}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}
