import {
  ArrowUturnLeftIcon,
  BanknotesIcon,
  ChevronRightIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import { MemberBadges } from "@/components/common/MemberBadges";
import { PaymentHistoryList, PaymentUndoConfirm } from "@/components/payments/PaymentHistoryPanel";
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
 *
 * History and the undo confirm are sub-views on the sheet stack (never a
 * second dialog); dismissing them returns one level up.
 */
export type PaymentOccurrenceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: HistoryRowItem | UpcomingRowItem | null;
  personIds?: string[];
  /** Underlying series row — used for "Izmeni" / "Istorija". Null if deleted. */
  payment: Payment | null;
  onEdit: (payment: Payment) => void;
};

type View =
  | { kind: "detail" }
  | { kind: "history" }
  // The undo confirm pops back to wherever it was requested from; a successful
  // undo from the footer closes the whole sheet (the occurrence is gone).
  | { kind: "undo"; from: "detail" | "history" };

export function PaymentOccurrenceDialog({
  open,
  onOpenChange,
  item,
  personIds = [],
  payment,
  onEdit,
}: PaymentOccurrenceDialogProps) {
  const { view, atRoot, push, pop, dialogOpen, dialogKey, handleOpenChange } = useSheetStack<View>(
    open,
    onOpenChange,
    { kind: "detail" },
  );

  const isUpcoming = item?.type === "upcoming";
  const subtitle = !item
    ? ""
    : isUpcoming
      ? `${recurrenceLabel(item.recurrence_period, item.recurrence_interval)} · nadolazeća rata`
      : item.status === "canceled"
        ? "Preskočena rata"
        : "Plaćena rata";

  const handleEdit = () => {
    if (!payment) return;
    onOpenChange(false);
    onEdit(payment);
  };

  const statusBadge = !item
    ? null
    : isUpcoming
      ? {
          label: "Nadolazeće",
          className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
        }
      : item.status === "canceled"
        ? {
            label: "Preskočeno",
            className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
          }
        : {
            label: `Plaćeno${item.paid_date ? ` ${formatDate(item.paid_date)}` : ""}`,
            className:
              "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
          };

  const canUndo = item?.type === "history" && item.isLast;

  const title =
    view.kind === "history"
      ? "Istorija plaćanja"
      : view.kind === "undo"
        ? "Poništi plaćanje"
        : "Detalji plaćanja";

  return (
    <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <SheetStackHeader title={title} srOnly={atRoot} onBack={atRoot ? undefined : pop} />
        {item ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                <BanknotesIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {item.name}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
              </div>
            </div>

            {view.kind === "history" ? (
              <PaymentHistoryList
                payment={payment}
                active={view.kind === "history"}
                onRequestUndo={() => push({ kind: "undo", from: "history" })}
              />
            ) : view.kind === "undo" ? (
              <PaymentUndoConfirm
                paymentId={payment?.id ?? (item.type === "history" ? item.payment_id : null)}
                paymentName={item.name}
                onBack={pop}
                onDone={() => {
                  if (view.from === "history") pop();
                  else onOpenChange(false);
                }}
              />
            ) : (
              <>
                <div>
                  <div className="text-3xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
                    <Amount value={item.amount} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {statusBadge ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}
                      >
                        {statusBadge.label}
                      </span>
                    ) : null}
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {isUpcoming ? "Dospeva" : "Dospelo"} {formatDate(item.due_date)}
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-gray-100 border-t border-gray-100 text-sm dark:divide-gray-700/60 dark:border-gray-700/60">
                  {personIds.length > 0 ? (
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-gray-500 dark:text-gray-400">Za</span>
                      <MemberBadges personIds={personIds} />
                    </div>
                  ) : null}
                  {item.type === "history" && item.note ? (
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">Napomena</span>
                      <span className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {item.note}
                      </span>
                    </div>
                  ) : null}
                  {isUpcoming && item.description ? (
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">Opis</span>
                      <span className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {item.description}
                      </span>
                    </div>
                  ) : null}
                  {isUpcoming &&
                  item.recurrence_period === "limited" &&
                  item.remaining_occurrences != null ? (
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-gray-500 dark:text-gray-400">Preostalo</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {item.remaining_occurrences} rata
                      </span>
                    </div>
                  ) : null}
                  {payment ? (
                    <button
                      type="button"
                      onClick={() => push({ kind: "history" })}
                      className="flex w-full items-center gap-2 py-2.5 text-sm font-medium text-gray-900 transition-colors hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:text-gray-100 dark:hover:text-blue-400"
                    >
                      <ClockIcon className="size-4 text-gray-400 dark:text-gray-500" />
                      Istorija plaćanja
                      <ChevronRightIcon className="ml-auto size-4 text-gray-400 dark:text-gray-500" />
                    </button>
                  ) : null}
                </div>

                {isUpcoming ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Nadolazeća rata — označavanje plaćenim, pomeranje i preskakanje postaju dostupni
                    kada rata dođe na red.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {view.kind === "history" ? (
          <ResponsiveDialogFooter>
            <Button variant="outline" className="w-full sm:w-auto" onClick={pop}>
              Nazad
            </Button>
          </ResponsiveDialogFooter>
        ) : view.kind === "undo" ? null : (
          <ResponsiveDialogFooter className="flex-row items-center gap-2 sm:justify-end">
            {payment ? (
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleEdit}>
                Izmeni
              </Button>
            ) : null}
            {canUndo ? (
              <Button
                className="flex-[1.4] sm:flex-none"
                onClick={() => push({ kind: "undo", from: "detail" })}
              >
                <ArrowUturnLeftIcon className="size-4" />
                Poništi plaćanje
              </Button>
            ) : null}
            {!payment && !canUndo ? (
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => onOpenChange(false)}
              >
                Zatvori
              </Button>
            ) : null}
          </ResponsiveDialogFooter>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
