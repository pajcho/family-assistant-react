import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { EventForm, type EventFormPayload } from "@/components/events/EventForm";
import type { Event } from "@/types/database";

export type EventFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  /** Assignees of the event being edited; empty/omitted when adding. */
  initialPersonIds?: string[];
  /** Inline error banner shown above the form (e.g. mutation failure). */
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: EventFormPayload) => void;
};

/**
 * Direct port of `components/events/EventFormDialog.vue`.
 *
 * Owns the ResponsiveDialog shell + inline error banner. The form fields
 * and footer buttons live inside <EventForm> so the dialog stays purely
 * about presentation; the parent page wires submit → mutation.
 *
 * On mobile (<sm) this becomes a bottom-sheet via vaul; on desktop it's
 * a centered modal. See `src/components/ui/responsive-dialog.tsx`.
 */
export function EventFormDialog({
  open,
  onOpenChange,
  event,
  initialPersonIds,
  error,
  saving,
  onSubmit,
}: EventFormDialogProps) {
  const title = event ? "Izmeni događaj" : "Dodaj događaj";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {error ? (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : null}
        <EventForm
          event={event}
          initialPersonIds={initialPersonIds}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
