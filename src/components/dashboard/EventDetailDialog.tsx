import { useEffect, useState } from "react";
import { CalendarDaysIcon, CalendarIcon, XCircleIcon } from "@heroicons/react/24/outline";

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
import { MemberBadges } from "@/components/common/MemberBadges";
import {
  EventDateTimeFields,
  type EventDateTimeValue,
  dateTimeValueToColumns,
  eventToDateTimeValue,
} from "@/components/events/EventDateTimeFields";
import type { Event } from "@/types/database";
import { useUpdateEvent } from "@/hooks/useEvents";
import { formatDate } from "@/utils/date";
import { formatEventTimeRange } from "@/utils/event";

/**
 * Shared event detail popup used by both `DashboardEventCard` (the 14-day
 * card) and `DashboardTodayCard` (the hero "Danas" widget). Each caller owns
 * its `selectedEvent`/`open` state, passes the event's assignees in, and
 * routes "Izmeni" back to its own form dialog through `onEdit`.
 *
 * "Pomeri" (date + time) and "Otkaži" (soft cancel with optional reason) are
 * self-contained here via `useUpdateEvent` — they swap the dialog body inline
 * (no nested dialogs) and close on success since a canceled/moved event
 * leaves the dashboard.
 */
export type EventDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  /** Family members the event is for (from the parent's participants query). */
  personIds?: string[];
  onEdit: (event: Event) => void;
};

type Mode = "detail" | "reschedule" | "cancel";

export function EventDetailDialog({
  open,
  onOpenChange,
  event,
  personIds = [],
  onEdit,
}: EventDetailDialogProps) {
  const updateEvent = useUpdateEvent();
  const [mode, setMode] = useState<Mode>("detail");
  const [dtValue, setDtValue] = useState<EventDateTimeValue>(() => eventToDateTimeValue(event));
  const [reason, setReason] = useState("");

  // Reset to the detail view whenever the dialog closes.
  useEffect(() => {
    if (!open) setMode("detail");
  }, [open]);
  // Reseed the inline editors when the selected event changes underneath.
  useEffect(() => {
    setMode("detail");
    setDtValue(eventToDateTimeValue(event));
    setReason("");
  }, [event]);

  const saving = updateEvent.isPending;

  const handleEdit = () => {
    if (!event) return;
    onOpenChange(false);
    onEdit(event);
  };

  const handleCancelConfirm = async () => {
    if (!event) return;
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        payload: { canceled_at: new Date().toISOString(), cancel_reason: reason.trim() || null },
      });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleRescheduleSave = async () => {
    if (!event || !dtValue.date) return;
    try {
      await updateEvent.mutateAsync({ id: event.id, payload: dateTimeValueToColumns(dtValue) });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const title =
    mode === "reschedule"
      ? "Pomeri događaj"
      : mode === "cancel"
        ? "Otkaži događaj"
        : "Detalji događaja";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {event ? (
          mode === "reschedule" ? (
            <EventDateTimeFields
              value={dtValue}
              onChange={setDtValue}
              idPrefix="detail-reschedule"
            />
          ) : mode === "cancel" ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Otkazati „{event.name}"? Neće se prikazivati na kontrolnoj tabli, ali ostaje u
                kalendaru.
              </p>
              <div className="space-y-2">
                <Label htmlFor="detail-cancel-reason">Razlog (opciono)</Label>
                <Textarea
                  id="detail-cancel-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="npr. otkazano zbog kiše"
                  rows={3}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
                  <CalendarIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {event.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(event.date)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Vreme:</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {formatEventTimeRange(event)}
                    </dd>
                  </div>
                  {personIds.length > 0 ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Za:</dt>
                      <dd>
                        <MemberBadges personIds={personIds} />
                      </dd>
                    </div>
                  ) : null}
                  {event.description ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {event.description}
                      </dd>
                    </div>
                  ) : null}
                  {event.notes ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Napomene:</dt>
                      <dd className="text-right font-medium text-amber-700 dark:text-amber-400">
                        {event.notes}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          )
        ) : null}

        {mode === "reschedule" ? (
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setMode("detail")} disabled={saving}>
              Nazad
            </Button>
            <Button
              onClick={() => {
                void handleRescheduleSave();
              }}
              disabled={saving || !dtValue.date}
            >
              Sačuvaj
            </Button>
          </ResponsiveDialogFooter>
        ) : mode === "cancel" ? (
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setMode("detail")} disabled={saving}>
              Nazad
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleCancelConfirm();
              }}
              disabled={saving}
            >
              Otkaži događaj
            </Button>
          </ResponsiveDialogFooter>
        ) : (
          <ResponsiveDialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex justify-center gap-2 sm:justify-start">
              <Button variant="ghost" size="sm" onClick={() => setMode("reschedule")}>
                <CalendarDaysIcon className="mr-1 h-4 w-4" />
                Pomeri
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700 dark:text-red-400"
                onClick={() => setMode("cancel")}
              >
                <XCircleIcon className="mr-1 h-4 w-4" />
                Otkaži
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                Zatvori
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleEdit}>
                Izmeni
              </Button>
            </div>
          </ResponsiveDialogFooter>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
