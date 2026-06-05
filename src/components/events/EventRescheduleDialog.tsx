import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  /** Optional free-text reason for the move; NULL when left blank. */
  reschedule_reason: string | null;
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
  const [reason, setReason] = useState("");

  useEffect(() => {
    setValue(eventToDateTimeValue(event));
    setReason("");
  }, [event]);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Pomeri događaj</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <EventDateTimeFields value={value} onChange={setValue} idPrefix="reschedule" />
          <div className="space-y-2">
            <Label htmlFor="reschedule-reason">Razlog (opciono)</Label>
            <Textarea
              id="reschedule-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="npr. termin pomeren zbog vremena"
              rows={2}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Odustani
          </Button>
          <Button
            disabled={saving || !value.date}
            onClick={() => {
              if (value.date)
                onSubmit({
                  ...dateTimeValueToColumns(value),
                  reschedule_reason: reason.trim() || null,
                });
            }}
          >
            Pomeri
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
