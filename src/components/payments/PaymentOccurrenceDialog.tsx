import { useEffect, useRef, useState } from "react";
import { ArrowUturnLeftIcon, BanknotesIcon, ClockIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { MemberBadges } from "@/components/common/MemberBadges";
import { PaymentHistoryPopup } from "@/components/payments/PaymentHistoryPopup";
import type { HistoryRowItem, UpcomingRowItem } from "@/components/payments/paymentRowTypes";
import type { Payment } from "@/types/database";
import { formatDate } from "@/utils/date";
import { Amount } from "@/components/common/Amount";
import { recurrenceLabel } from "@/utils/payment";

/**
 * Read-only detail popup for the two occurrence rows that aren't the series'
 * live one: paid/skipped HISTORY entries and projected UPCOMING repetitions.
 * Neither maps onto a mutable `Payment` occurrence, so this shows the frozen
 * snapshot plus the one action that applies — "Poništi" on the last history
 * entry, "Izmeni" on the underlying series. The live occurrence gets the full
 * `PaymentDetailDialog` instead.
 */
export type PaymentOccurrenceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: HistoryRowItem | UpcomingRowItem | null;
  personIds?: string[];
  /** Underlying series row — used for "Izmeni" / "Istorija". Null if deleted. */
  payment: Payment | null;
  onEdit: (payment: Payment) => void;
  onUndo: (item: HistoryRowItem) => void;
};

export function PaymentOccurrenceDialog({
  open,
  onOpenChange,
  item,
  personIds = [],
  payment,
  onEdit,
  onUndo,
}: PaymentOccurrenceDialogProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  // Re-open the detail popup when the history sheet closes (mirrors
  // PaymentDetailDialog), so "Istorija" → back lands where the user was.
  const prevHistoryOpen = useRef(false);
  useEffect(() => {
    if (prevHistoryOpen.current && !historyOpen && item) onOpenChange(true);
    prevHistoryOpen.current = historyOpen;
  }, [historyOpen, item, onOpenChange]);

  const isUpcoming = item?.type === "upcoming";
  const subtitle = !item
    ? ""
    : isUpcoming
      ? `${recurrenceLabel(item.recurrence_period, item.recurrence_interval)} · nadolazeća rata`
      : item.status === "canceled"
        ? "Preskočena rata"
        : "Plaćena rata";

  const openHistory = () => {
    onOpenChange(false);
    setHistoryOpen(true);
  };

  const handleEdit = () => {
    if (!payment) return;
    onOpenChange(false);
    onEdit(payment);
  };

  const handleUndo = () => {
    if (!item || item.type !== "history") return;
    onOpenChange(false);
    onUndo(item);
  };

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Detalji plaćanja</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {item ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                  <BanknotesIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {item.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Iznos:</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      <Amount value={item.amount} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Datum dospeća:</dt>
                    <dd className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                      {formatDate(item.due_date)}
                      {isUpcoming ? (
                        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-200">
                          Nadolazeće
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Status:</dt>
                    <dd
                      className={
                        isUpcoming
                          ? "text-gray-600 dark:text-gray-300"
                          : item.type === "history" && item.status === "canceled"
                            ? "text-gray-600 dark:text-gray-300"
                            : "text-emerald-700 dark:text-emerald-400"
                      }
                    >
                      {isUpcoming
                        ? "Nadolazeće"
                        : item.type === "history" && item.status === "canceled"
                          ? "Preskočeno"
                          : `Plaćeno${item.type === "history" && item.paid_date ? ` · ${formatDate(item.paid_date)}` : ""}`}
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
                  {item.type === "history" && item.note ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Napomena:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {item.note}
                      </dd>
                    </div>
                  ) : null}
                  {isUpcoming && item.description ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {item.description}
                      </dd>
                    </div>
                  ) : null}
                  {isUpcoming &&
                  item.recurrence_period === "limited" &&
                  item.remaining_occurrences != null ? (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Preostalo:</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100">
                        {item.remaining_occurrences} rata
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              {isUpcoming ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Nadolazeća rata — označavanje plaćenim, pomeranje i preskakanje postaju dostupni
                  kada rata dođe na red.
                </p>
              ) : null}
            </div>
          ) : null}

          <ResponsiveDialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex justify-center gap-1 sm:justify-start">
              {item?.type === "history" ? (
                <>
                  {payment ? (
                    <Button variant="ghost" size="sm" onClick={openHistory}>
                      <ClockIcon className="mr-1 h-4 w-4" />
                      Istorija
                    </Button>
                  ) : null}
                  {item.isLast ? (
                    <Button variant="ghost" size="sm" onClick={handleUndo}>
                      <ArrowUturnLeftIcon className="mr-1 h-4 w-4" />
                      Poništi
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                Zatvori
              </Button>
              {payment ? (
                <Button className="w-full sm:w-auto" onClick={handleEdit}>
                  Izmeni
                </Button>
              ) : null}
            </div>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PaymentHistoryPopup open={historyOpen} onOpenChange={setHistoryOpen} payment={payment} />
    </>
  );
}
