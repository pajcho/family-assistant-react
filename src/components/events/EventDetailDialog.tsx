import { useEffect, useState } from "react";
import {
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  CalendarIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import {
  SheetActionList,
  SheetActionsMenu,
  SheetActionsMobileTrigger,
  type SheetAction,
} from "@/components/common/SheetActions";
import {
  EventDateTimeFields,
  type EventDateTimeValue,
  dateTimeValueToColumns,
  eventToDateTimeValue,
} from "@/components/events/EventDateTimeFields";
import { MemberBadges } from "@/components/common/MemberBadges";
import { useDeleteEvent, useUpdateEvent } from "@/hooks/useEvents";
import { cn } from "@/lib/cn";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatEventTimeRange, isEventEnded } from "@/utils/event";

/**
 * Detail popup for one event on the /events page - the payments-sheet
 * pattern: hero (icon + name + time), state as badges, info rows, footer with
 * "Izmeni" (+ "Vrati" as the contextual primary when canceled), everything
 * else behind the secondary actions menu (mobile: "Opcije" sub-view,
 * desktop: labeled footer dropdown).
 *
 * Reschedule, cancel-with-reason and the delete confirm are sub-views on the
 * sheet stack (see `useSheetStack`) - same sheet, "←" back header, dismissal
 * returns one level up. Only the full edit form still closes the sheet and
 * delegates to the page's form dialog via `onEdit`.
 */
export type EventDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  personIds?: string[];
  onEdit: (event: Event) => void;
};

type View = "detail" | "actions" | "reschedule" | "cancel" | "delete";

export function EventDetailDialog({
  open,
  onOpenChange,
  event,
  personIds = [],
  onEdit,
}: EventDetailDialogProps) {
  const { view, atRoot, push, pop, reset, dialogOpen, dialogKey, handleOpenChange } =
    useSheetStack<View>(open, onOpenChange, "detail");
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const [dtValue, setDtValue] = useState<EventDateTimeValue>(() => eventToDateTimeValue(event));
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  // Back to the root view whenever the subject event changes underneath.
  useEffect(() => {
    reset();
  }, [event, reset]);

  const saving = updateEvent.isPending || deleteEvent.isPending;
  const isCanceled = !!event?.canceled_at;
  const isEnded = !!event && !isCanceled && isEventEnded(event);

  // The full edit form lives in the page's own dialog - close and hand off.
  const handleEdit = () => {
    if (!event) return;
    onOpenChange(false);
    onEdit(event);
  };

  // Seed a clean slate each time a sub-view is entered (not just per-event),
  // so a back-and-forth within one open doesn't carry stale unsaved input.
  const openReschedule = () => {
    setDtValue(eventToDateTimeValue(event));
    setRescheduleReason("");
    push("reschedule");
  };

  const openCancel = () => {
    setCancelReason("");
    push("cancel");
  };

  const handleRescheduleSave = async () => {
    if (!event || !dtValue.date) return;
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        payload: {
          ...dateTimeValueToColumns(dtValue),
          reschedule_reason: rescheduleReason.trim() || null,
        },
      });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleCancelConfirm = async () => {
    if (!event) return;
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        payload: {
          canceled_at: new Date().toISOString(),
          cancel_reason: cancelReason.trim() || null,
        },
      });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  // Restoring a canceled event clears both the timestamp and the reason.
  const handleRestore = async () => {
    if (!event) return;
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        payload: { canceled_at: null, cancel_reason: null },
      });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    try {
      await deleteEvent.mutateAsync(event.id);
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const actionItems: SheetAction[] = [];
  if (event && !isCanceled) {
    actionItems.push({
      key: "reschedule",
      label: "Pomeri datum",
      icon: CalendarDaysIcon,
      onSelect: openReschedule,
    });
    actionItems.push({
      key: "cancel",
      label: "Otkaži događaj",
      icon: XCircleIcon,
      onSelect: openCancel,
    });
  }
  actionItems.push({
    key: "delete",
    label: "Obriši događaj",
    icon: TrashIcon,
    destructive: true,
    separatorBefore: actionItems.length > 0,
    onSelect: () => push("delete"),
  });

  const statusBadges: { label: string; className: string }[] = [];
  if (event) {
    if (isCanceled) {
      statusBadges.push({
        label: "Otkazano",
        className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      });
    } else if (isEnded) {
      statusBadges.push({
        label: "Završeno",
        className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
      });
    }
    statusBadges.push({
      label: formatDate(event.date),
      className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    });
  }

  const title =
    view === "actions"
      ? "Opcije"
      : view === "reschedule"
        ? "Pomeri događaj"
        : view === "cancel"
          ? "Otkaži događaj"
          : view === "delete"
            ? "Obriši događaj"
            : "Detalji događaja";

  return (
    <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <SheetStackHeader title={title} srOnly={atRoot} onBack={atRoot ? undefined : pop} />
        {event ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
                <CalendarIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-lg font-semibold text-gray-900 dark:text-gray-100",
                    isCanceled && "text-gray-500 line-through dark:text-gray-500",
                  )}
                >
                  {event.name}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {formatEventTimeRange(event)}
                </p>
              </div>
              {view === "detail" ? (
                <SheetActionsMobileTrigger
                  items={actionItems}
                  disabled={saving}
                  onOpenActions={() => push("actions")}
                />
              ) : null}
            </div>

            {view === "actions" ? (
              <SheetActionList items={actionItems} disabled={saving} />
            ) : view === "reschedule" ? (
              <div className="space-y-4">
                <EventDateTimeFields
                  value={dtValue}
                  onChange={setDtValue}
                  idPrefix="event-detail-reschedule"
                />
                <div className="space-y-2">
                  <Label htmlFor="event-detail-reschedule-reason">Razlog (opciono)</Label>
                  <Textarea
                    id="event-detail-reschedule-reason"
                    value={rescheduleReason}
                    onChange={(e) => setRescheduleReason(e.target.value)}
                    placeholder="npr. termin pomeren zbog vremena"
                    rows={2}
                  />
                </div>
              </div>
            ) : view === "cancel" ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Otkazati „{event.name}"? Neće se prikazivati na kontrolnoj tabli, ali ostaje u
                  kalendaru. Možeš ga kasnije vratiti.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="event-detail-cancel-reason">Razlog (opciono)</Label>
                  <Textarea
                    id="event-detail-cancel-reason"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="npr. otkazano zbog kiše"
                    rows={3}
                  />
                </div>
              </div>
            ) : view === "delete" ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Da li ste sigurni da želite da obrišete „{event.name}"? Ova radnja se ne može
                opozvati.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  {statusBadges.map((badge) => (
                    <span
                      key={badge.label}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>

                <div className="divide-y divide-gray-100 border-t border-gray-100 text-sm dark:divide-gray-700/60 dark:border-gray-700/60">
                  {personIds.length > 0 ? (
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-gray-500 dark:text-gray-400">Za</span>
                      <MemberBadges personIds={personIds} />
                    </div>
                  ) : null}
                  {event.description ? (
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">Opis</span>
                      <span className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {event.description}
                      </span>
                    </div>
                  ) : null}
                  {event.notes ? (
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">Napomena</span>
                      <span className="text-right font-medium text-amber-700 dark:text-amber-400">
                        {event.notes}
                      </span>
                    </div>
                  ) : null}
                  {isCanceled && event.cancel_reason ? (
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">
                        Razlog otkazivanja
                      </span>
                      <span className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {event.cancel_reason}
                      </span>
                    </div>
                  ) : null}
                  {event.reschedule_reason ? (
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">
                        Razlog pomeranja
                      </span>
                      <span className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {event.reschedule_reason}
                      </span>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {view === "actions" ? (
          <ResponsiveDialogFooter>
            <Button variant="outline" className="w-full sm:w-auto" onClick={pop} disabled={saving}>
              Nazad
            </Button>
          </ResponsiveDialogFooter>
        ) : view === "reschedule" ? (
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={pop} disabled={saving}>
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
        ) : view === "cancel" ? (
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={pop} disabled={saving}>
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
        ) : view === "delete" ? (
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={pop} disabled={saving}>
              Nazad
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleDelete();
              }}
              disabled={saving}
            >
              Obriši
            </Button>
          </ResponsiveDialogFooter>
        ) : (
          <ResponsiveDialogFooter className="flex-row items-center gap-2 sm:justify-end">
            <SheetActionsMenu items={actionItems} disabled={saving} className="mr-auto" />
            {isCanceled ? (
              <>
                <Button
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={handleEdit}
                  disabled={saving}
                >
                  Izmeni
                </Button>
                {/* Contextual primary: un-cancel is the state-fixing action. */}
                <Button
                  className="flex-[1.4] sm:flex-none"
                  onClick={() => {
                    void handleRestore();
                  }}
                  disabled={saving}
                >
                  <ArrowUturnLeftIcon className="size-4" />
                  Vrati događaj
                </Button>
              </>
            ) : (
              <Button className="flex-1 sm:flex-none" onClick={handleEdit} disabled={saving}>
                Izmeni
              </Button>
            )}
          </ResponsiveDialogFooter>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
