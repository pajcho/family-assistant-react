import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  EventDateTimeFields,
  type EventDateTimeValue,
  dateTimeValueToColumns,
  eventToDateTimeValue,
} from "@/components/events/EventDateTimeFields";
import type { Event } from "@/types/database";

export type EventReschedulePayload = {
  date: string;
  start_time: string | null;
  end_time: string | null;
};

/**
 * Quick "Pomeri" affordance: move an event to a new date and/or time without
 * the full edit form. No old-date history is kept — this just writes the new
 * date + times back onto the event.
 */
export type EventRescheduleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  saving?: boolean;
  onSubmit: (payload: EventReschedulePayload) => void;
};

export function EventRescheduleDialog({
  open,
  onOpenChange,
  event,
  saving,
  onSubmit,
}: EventRescheduleDialogProps) {
  const [value, setValue] = useState<EventDateTimeValue>(() => eventToDateTimeValue(event));

  useEffect(() => {
    setValue(eventToDateTimeValue(event));
  }, [event]);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Pomeri događaj</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <EventDateTimeFields value={value} onChange={setValue} idPrefix="reschedule" />
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Otkaži
          </Button>
          <Button
            disabled={saving || !value.date}
            onClick={() => {
              if (value.date) onSubmit(dateTimeValueToColumns(value));
            }}
          >
            Pomeri
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
