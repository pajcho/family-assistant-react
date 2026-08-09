import { ActivityDetailDialog } from "@/components/activities/ActivityDetailDialog";
import { BirthdayDetailDialog } from "@/components/birthdays/BirthdayDetailDialog";
import { EventDetailDialog } from "@/components/events/EventDetailDialog";
import type { EditableEntityRef } from "@/components/payments/LinkedEntityEditor";
import { useActivities } from "@/hooks/useActivities";
import { useBirthdaysData } from "@/hooks/useBirthdays";
import { useEventById } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import type { PaymentLinkTarget } from "@/hooks/usePaymentLinks";

/**
 * In-place DETAIL popup for the entity a payment points at - what opens when
 * you tap its "Povezano sa" chip. Tapping a link is a "show me what this is"
 * gesture, so it lands on the same detail sheet the entity's own page opens
 * (`EventDetailDialog` / `ActivityDetailDialog` / `BirthdayDetailDialog`),
 * never straight on an edit form.
 *
 * "Izmeni" inside those sheets is delegated back up through `onEdit`; the host
 * routes it to `LinkedEntityEditor`, which owns every in-place edit form. The
 * detail sheets close THEMSELVES before delegating, so `onClose` and `onEdit`
 * arrive in the same batch and the host must handle that pair (see
 * `PaymentDetailDialog`) - the same shape as the birthday sheet's celebration
 * flow.
 *
 * Reached only through `lazyLinkedEntityViewer`: payment ⇄ entity detail is
 * mutually recursive (an event's detail lists its payments, whose detail links
 * back to the event), and the dynamic import is what keeps that a lazy edge
 * instead of a module cycle.
 *
 * Renders nothing until `target` is set, so the data hooks below only fire
 * once actually opened (the inner component mounts lazily).
 */
export type LinkedEntityViewerProps = {
  /** The tapped link; null renders nothing. */
  target: PaymentLinkTarget | null;
  /** Dismissed - the host sheet underneath comes back. */
  onClose: () => void;
  /** "Izmeni" tapped inside the detail sheet - open the edit form for it. */
  onEdit: (target: EditableEntityRef) => void;
};

export function LinkedEntityViewer({ target, onClose, onEdit }: LinkedEntityViewerProps) {
  if (!target) return null;
  if (target.kind === "event") {
    return <EventLinkView id={target.id} onClose={onClose} onEdit={onEdit} />;
  }
  if (target.kind === "activity") {
    return <ActivityLinkView id={target.id} onClose={onClose} onEdit={onEdit} />;
  }
  return <BirthdayLinkView id={target.id} onClose={onClose} onEdit={onEdit} />;
}

export default LinkedEntityViewer;

type ViewProps = {
  id: string;
  onClose: () => void;
  onEdit: (target: EditableEntityRef) => void;
};

function EventLinkView({ id, onClose, onEdit }: ViewProps) {
  // By-id fetch: the linked event can sit outside every warm list window - a
  // payment made today can point at an event months back.
  const eventQuery = useEventById(id);
  const { byEvent } = useEventParticipants();
  const event = eventQuery.data ?? null;

  return (
    <EventDetailDialog
      open={!!event}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      event={event}
      personIds={byEvent.get(id) ?? []}
      onEdit={() => onEdit({ kind: "event", id })}
    />
  );
}

function ActivityLinkView({ id, onClose, onEdit }: ViewProps) {
  const activitiesQuery = useActivities();
  const activity = (activitiesQuery.data ?? []).find((a) => a.id === id) ?? null;

  return (
    <ActivityDetailDialog
      open={!!activity}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      activity={activity}
      onEdit={() => onEdit({ kind: "activity", id })}
    />
  );
}

function BirthdayLinkView({ id, onClose, onEdit }: ViewProps) {
  const { data: birthdays } = useBirthdaysData();
  const birthday = (birthdays ?? []).find((b) => b.id === id) ?? null;

  return (
    <BirthdayDetailDialog
      open={!!birthday}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      birthday={birthday}
      onEdit={() => onEdit({ kind: "birthday", id })}
    />
  );
}
