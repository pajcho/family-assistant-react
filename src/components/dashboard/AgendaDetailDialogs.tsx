import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { BlockActionDialog } from "@/components/activities/BlockActionDialog";
import { BirthdayDetailDialog } from "@/components/dashboard/BirthdayDetailDialog";
import { EventDetailDialog } from "@/components/dashboard/EventDetailDialog";
import { PaymentDetailDialog } from "@/components/dashboard/PaymentDetailDialog";
import type { AgendaItem } from "@/hooks/useAgenda";
import { useActivities } from "@/hooks/useActivities";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import type { Activity, Birthday, Event, Payment } from "@/types/database";
import type { ResolvedActivityBlock } from "@/utils/activity";

/**
 * Shared detail-dialog plumbing for the agenda tabs. Owns the per-kind
 * selection state and renders the four detail popups once, so both the "Danas"
 * and "Uskoro" tabs route a row click to the same dialog set. Activity / event
 * / payment rows open the same popups the dedicated feature cards used; "Izmeni"
 * inside event/payment/birthday flows back to the dashboard's form dialogs via
 * `onEditEvent` / `onEditPayment` / `onEditBirthday`. Activity edit deep-links to
 * /activities (that page owns the activity form).
 */
export function useAgendaDetails({
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: {
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
}): { onSelect: (item: AgendaItem) => void; dialogs: ReactNode } {
  const navigate = useNavigate();
  const { byId: peopleById } = useFamilyMembers();
  const { byEvent } = useEventParticipants();
  const { byPayment } = usePaymentParticipants();
  const { data: activities } = useActivities();

  const activitiesById = useMemo(() => {
    const map = new Map<string, Activity>();
    for (const a of activities ?? []) map.set(a.id, a);
    return map;
  }, [activities]);

  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<ResolvedActivityBlock | null>(null);
  const [selectedBirthday, setSelectedBirthday] = useState<Birthday | null>(null);

  const onSelect = (item: AgendaItem) => {
    switch (item.kind) {
      case "activity":
        setSelectedBlock(item.block);
        break;
      case "event":
        setSelectedEvent(item.event);
        break;
      case "payment":
        setSelectedPayment(item.payment);
        break;
      case "birthday":
        setSelectedBirthday(item.birthday);
        break;
    }
  };

  const dialogs = (
    <>
      <EventDetailDialog
        open={!!selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
        event={selectedEvent}
        personIds={selectedEvent ? (byEvent.get(selectedEvent.id) ?? []) : []}
        onEdit={onEditEvent}
      />

      <PaymentDetailDialog
        open={!!selectedPayment}
        onOpenChange={(open) => {
          if (!open) setSelectedPayment(null);
        }}
        payment={selectedPayment}
        personIds={selectedPayment ? (byPayment.get(selectedPayment.id) ?? []) : []}
        onEdit={onEditPayment}
      />

      <BlockActionDialog
        open={!!selectedBlock}
        onOpenChange={(open) => {
          if (!open) setSelectedBlock(null);
        }}
        block={selectedBlock}
        activity={selectedBlock ? activitiesById.get(selectedBlock.activityId) : undefined}
        person={selectedBlock ? peopleById.get(selectedBlock.personId) : undefined}
        onEditActivity={(activity) => {
          void navigate({ to: "/activities", search: { edit: activity.id } });
        }}
      />

      <BirthdayDetailDialog
        open={!!selectedBirthday}
        onOpenChange={(open) => {
          if (!open) setSelectedBirthday(null);
        }}
        birthday={selectedBirthday}
        onEdit={onEditBirthday}
      />
    </>
  );

  return { onSelect, dialogs };
}
