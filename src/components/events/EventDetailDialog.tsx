import { useEffect, useState } from "react";
import {
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  CalendarIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  SheetActionList,
  SheetActionsKebab,
  type SheetAction,
} from "@/components/common/SheetActions";
import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatEventTimeRange, isEventEnded } from "@/utils/event";

/**
 * Detail popup for one event on the /events page — the payments-sheet
 * pattern: hero (icon + name + time), state as badges, info rows, footer with
 * "Izmeni" (+ "Vrati" as the contextual primary when canceled), everything
 * else behind the kebab (mobile: "Opcije" sub-view, desktop: dropdown).
 *
 * The heavier flows (edit form, reschedule, cancel-with-reason, delete
 * confirm) already live in the page's own dialogs — this sheet closes itself
 * and delegates (the PaymentHistoryPopup close-then-open pattern; never stack
 * two drawers).
 */
export type EventDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  personIds?: string[];
  onEdit: (event: Event) => void;
  onReschedule: (event: Event) => void;
  onToggleCancel: (event: Event) => void;
  onDelete: (event: Event) => void;
};

type Mode = "detail" | "actions";

export function EventDetailDialog({
  open,
  onOpenChange,
  event,
  personIds = [],
  onEdit,
  onReschedule,
  onToggleCancel,
  onDelete,
}: EventDetailDialogProps) {
  const [mode, setMode] = useState<Mode>("detail");

  useEffect(() => {
    if (!open) setMode("detail");
  }, [open]);
  useEffect(() => {
    setMode("detail");
  }, [event]);

  const isCanceled = !!event?.canceled_at;
  const isEnded = !!event && !isCanceled && isEventEnded(event);

  // Close first, then hand off to the page's own dialog for the flow.
  const delegate = (action: (event: Event) => void) => {
    if (!event) return;
    onOpenChange(false);
    action(event);
  };

  const actionItems: SheetAction[] = [];
  if (event && !isCanceled) {
    actionItems.push({
      key: "reschedule",
      label: "Pomeri datum",
      icon: CalendarDaysIcon,
      onSelect: () => delegate(onReschedule),
    });
    actionItems.push({
      key: "cancel",
      label: "Otkaži događaj",
      icon: XCircleIcon,
      onSelect: () => delegate(onToggleCancel),
    });
  }
  actionItems.push({
    key: "delete",
    label: "Obriši događaj",
    icon: TrashIcon,
    destructive: true,
    separatorBefore: actionItems.length > 0,
    onSelect: () => delegate(onDelete),
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

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader className={mode === "detail" ? "sr-only" : undefined}>
          <ResponsiveDialogTitle>
            {mode === "actions" ? "Opcije" : "Detalji događaja"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
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
              {mode === "detail" ? (
                <SheetActionsKebab items={actionItems} onOpenActions={() => setMode("actions")} />
              ) : null}
            </div>

            {mode === "actions" ? (
              <SheetActionList items={actionItems} />
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

        {mode === "actions" ? (
          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setMode("detail")}
            >
              Nazad
            </Button>
          </ResponsiveDialogFooter>
        ) : (
          <ResponsiveDialogFooter className="flex-row items-center gap-2 sm:justify-end">
            {isCanceled ? (
              <>
                <Button
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => delegate(onEdit)}
                >
                  Izmeni
                </Button>
                {/* Contextual primary: un-cancel is the state-fixing action. */}
                <Button
                  className="flex-[1.4] sm:flex-none"
                  onClick={() => delegate(onToggleCancel)}
                >
                  <ArrowUturnLeftIcon className="size-4" />
                  Vrati događaj
                </Button>
              </>
            ) : (
              <Button className="flex-1 sm:flex-none" onClick={() => delegate(onEdit)}>
                Izmeni
              </Button>
            )}
          </ResponsiveDialogFooter>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
