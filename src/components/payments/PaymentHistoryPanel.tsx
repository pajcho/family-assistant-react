import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { usePaymentHistoryByPaymentId, useUndoLastPayment } from "@/hooks/usePayments";
import type { Payment } from "@/types/database";
import { formatDate } from "@/utils/date";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { cn } from "@/lib/cn";

/**
 * Bodies for the "Istorija plaćanja" and "Poništi" sub-views that the payment
 * detail sheets (PaymentDetailDialog, PaymentOccurrenceDialog) render on their
 * sheet stack - history is a pushed view inside the SAME sheet, not a second
 * dialog (the old PaymentHistoryPopup), and the undo confirm is one more
 * level on the stack, not a dialog stacked on top.
 */

export type PaymentHistoryListProps = {
  /** The payment whose history we're inspecting; null while closed. */
  payment: Payment | null;
  /** "Poništi" on the latest entry - the parent pushes its undo view. */
  onRequestUndo: () => void;
};

/**
 * Every paid instance of a recurring payment (latest first), with an inline
 * "Poništi" link on the most recent entry.
 */
export function PaymentHistoryList({ payment, onRequestUndo }: PaymentHistoryListProps) {
  // This component only exists while the history sub-view is mounted, so the
  // payment id itself is the query gate.
  const historyQuery = usePaymentHistoryByPaymentId(payment?.id);
  const history = historyQuery.data ?? [];
  const loading = historyQuery.isLoading || historyQuery.isFetching;

  if (loading) {
    return <div className="py-4 text-center text-sm text-muted-foreground">Učitavanje…</div>;
  }

  if (history.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        Nema zabeleženih uplata za ovo plaćanje.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {history.map((entry, index) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-4 py-3"
        >
          <div className="flex flex-col gap-0.5">
            <span
              className={cn(
                "text-sm font-medium text-foreground",
                entry.status === "canceled" && "text-muted-foreground line-through",
              )}
            >
              {`${index + 1}. Dospeće ${formatDate(entry.due_date)}`}
            </span>
            <span className="text-xs text-muted-foreground">
              {entry.status === "canceled"
                ? `Otkazano${entry.note ? ` · ${entry.note}` : ""}`
                : `Plaćeno ${entry.paid_date ? formatDate(entry.paid_date) : ""}`}
            </span>
            {/* Frozen name from that occurrence - shown only when it
                differs from the payment's current name (renamed since). */}
            {entry.name && payment && entry.name !== payment.name ? (
              <span className="text-xs text-muted-foreground">Naziv tada: {entry.name}</span>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span
              className={cn(
                "font-bold tracking-[-0.01em] tabular-nums",
                entry.status === "canceled" ? "text-neg" : "text-pos",
              )}
            >
              <Amount value={entry.amount} />
            </span>
            <AmountOriginal
              amount={entry.original_amount}
              currency={entry.currency}
              className="text-[10px]"
            />
            {index === 0 ? (
              <button
                type="button"
                onClick={onRequestUndo}
                className="inline-flex items-center gap-1 py-1.5 text-xs font-semibold text-neg underline-offset-4 hover:underline"
              >
                <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                Poništi
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export type PaymentUndoConfirmProps = {
  /** Series id - a history row's `payment_id` still works if the series row is gone. */
  paymentId: string | null;
  paymentName: string;
  /** "Odustani" - pop back to the view the undo was requested from. */
  onBack: () => void;
  /** Called after a successful undo (queries refresh underneath). */
  onDone: () => void;
};

/** Confirm view for undoing the LAST recorded payment of a series. */
export function PaymentUndoConfirm({
  paymentId,
  paymentName,
  onBack,
  onDone,
}: PaymentUndoConfirmProps) {
  const undoMutation = useUndoLastPayment();

  const handleConfirm = async () => {
    if (!paymentId) return;
    try {
      await undoMutation.mutateAsync(paymentId);
      onDone();
    } catch {
      // Toast surfaced by the hook's onError; stay here so the user can
      // retry or go back.
    }
  };

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          {`Da li ste sigurni da želite da poništite poslednje plaćanje za "${paymentName}"?`}
        </p>
        <p className="text-sm text-muted-foreground">
          Ovo će obrisati zapis iz istorije i vratiti datum dospeća na prethodni mesec.
        </p>
      </div>
      <ResponsiveDialogFooter>
        <Button variant="outline" onClick={onBack} disabled={undoMutation.isPending}>
          Odustani
        </Button>
        <Button
          variant="destructive"
          disabled={undoMutation.isPending}
          onClick={() => {
            void handleConfirm();
          }}
        >
          Poništi
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
