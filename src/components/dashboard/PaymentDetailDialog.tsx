import { useEffect, useRef, useState } from "react";
import {
  BanknotesIcon,
  CalendarDaysIcon,
  XCircleIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { PaymentHistoryPopup } from "@/components/payments/PaymentHistoryPopup";
import { MemberBadges } from "@/components/common/MemberBadges";
import {
  useCancelPaymentOccurrence,
  useMarkPaymentPaid,
  useUpdatePayment,
} from "@/hooks/usePayments";
import {
  effectivePaymentDueDate,
  overrideKey,
  useDeletePaymentOverride,
  usePaymentOverrides,
  useUpsertPaymentOverride,
} from "@/hooks/usePaymentOverrides";
import type { Payment } from "@/types/database";
import { formatDate, isOverdue, subtractDay } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { nextPaymentOccurrenceDate, paymentCancelCopy, recurrenceLabel } from "@/utils/payment";

/**
 * Shared payment detail popup opened from the agenda tabs (via
 * `useAgendaDetails`). Self-contained: owns the history popup state and the
 * mutations. Like the event detail dialog, "Pomeri" (reschedule) and "Otkaži"
 * (cancel) the CURRENT occurrence inline (no nested dialogs), branching on
 * recurring vs one-time exactly like the /payments kebab:
 *   - reschedule: recurring → per-occurrence override ("Pomereno"); one-time →
 *     edits `due_date`.
 *   - cancel: recurring → records a canceled history entry + advances to the
 *     next occurrence; one-time → display-only cancel override.
 * A reschedule override can be undone with "Vrati". The "Izmeni" button
 * delegates the full edit form to the caller via `onEdit`.
 */
export type PaymentDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
  /** Family members the payment is for (from the parent's participants query). */
  personIds?: string[];
  onEdit: (payment: Payment) => void;
};

type Mode = "detail" | "reschedule" | "cancel";

function paymentSubtitle(payment: Payment): string {
  if (payment.recurrence_period === "limited") return "Plaćanje na rate";
  const base = recurrenceLabel(payment.recurrence_period, payment.recurrence_interval);
  if (payment.recurrence_period === "one-time" || payment.recurrence_period == null) {
    return "Jednokratno plaćanje";
  }
  return `${base} plaćanje`;
}

export function PaymentDetailDialog({
  open,
  onOpenChange,
  payment,
  personIds = [],
  onEdit,
}: PaymentDetailDialogProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("detail");
  const [newDate, setNewDate] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const markPaid = useMarkPaymentPaid();
  const updatePayment = useUpdatePayment();
  const upsertOverride = useUpsertPaymentOverride();
  const deleteOverride = useDeletePaymentOverride();
  const cancelOccurrence = useCancelPaymentOccurrence();
  const { byKey: overridesByKey } = usePaymentOverrides();

  const override = payment
    ? (overridesByKey.get(overrideKey(payment.id, payment.due_date)) ?? null)
    : null;
  const effectiveDue = payment
    ? effectivePaymentDueDate(payment.id, payment.due_date, overridesByKey)
    : "";
  const isRecurring =
    !!payment && payment.recurrence_period !== "one-time" && payment.recurrence_period != null;
  const saving =
    markPaid.isPending ||
    updatePayment.isPending ||
    upsertOverride.isPending ||
    deleteOverride.isPending ||
    cancelOccurrence.isPending;

  // Reset to the detail view whenever the dialog closes or the payment changes.
  useEffect(() => {
    if (!open) setMode("detail");
  }, [open]);
  useEffect(() => {
    setMode("detail");
  }, [payment]);

  // Re-open the detail popup when the history sheet closes so the user lands
  // back where they were. Mirrors the Vue `watch(historyOpen, ...)`.
  const prevHistoryOpen = useRef(false);
  useEffect(() => {
    if (prevHistoryOpen.current && !historyOpen && payment) {
      onOpenChange(true);
    }
    prevHistoryOpen.current = historyOpen;
  }, [historyOpen, payment, onOpenChange]);

  const handleEdit = () => {
    if (!payment) return;
    onOpenChange(false);
    onEdit(payment);
  };

  const openHistory = () => {
    onOpenChange(false);
    setHistoryOpen(true);
  };

  const handleMarkAsPaid = async () => {
    if (!payment) return;
    try {
      await markPaid.mutateAsync(payment.id);
      onOpenChange(false);
    } catch {
      // Toast surfaced by hook's onError; keep popup open so user can retry.
    }
  };

  const openReschedule = () => {
    setNewDate(effectiveDue || (payment?.due_date ?? null));
    setReason("");
    setMode("reschedule");
  };

  const openCancel = () => {
    setReason("");
    setMode("cancel");
  };

  const handleRescheduleSave = async () => {
    if (!payment || !newDate) return;
    try {
      if (isRecurring) {
        await upsertOverride.mutateAsync({
          paymentId: payment.id,
          occurrenceDate: payment.due_date,
          action: "reschedule",
          overrideDate: newDate,
          reason: reason.trim() || null,
        });
      } else {
        await updatePayment.mutateAsync({ id: payment.id, payload: { due_date: newDate } });
      }
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleCancelConfirm = async () => {
    if (!payment) return;
    try {
      if (isRecurring) {
        await cancelOccurrence.mutateAsync({ id: payment.id, reason: reason.trim() || null });
      } else {
        await upsertOverride.mutateAsync({
          paymentId: payment.id,
          occurrenceDate: payment.due_date,
          action: "cancel",
          reason: reason.trim() || null,
        });
      }
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleRestore = async () => {
    if (!payment) return;
    try {
      await deleteOverride.mutateAsync({ paymentId: payment.id, occurrenceDate: payment.due_date });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const cancelCopy = payment ? paymentCancelCopy(payment) : null;
  const rescheduleNext = payment ? nextPaymentOccurrenceDate(payment) : null;
  const rescheduleMax = rescheduleNext ? subtractDay(rescheduleNext) : null;
  const title =
    mode === "reschedule"
      ? "Pomeri ratu"
      : mode === "cancel"
        ? (cancelCopy?.title ?? "Otkaži ratu")
        : "Detalji plaćanja";

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {payment ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                  <BanknotesIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {payment.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {paymentSubtitle(payment)}
                  </p>
                </div>
              </div>

              {mode === "reschedule" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="payment-detail-reschedule-date">Novi datum</Label>
                    <DatePicker
                      id="payment-detail-reschedule-date"
                      value={newDate}
                      onChange={setNewDate}
                      placeholder="Izaberi datum"
                      maxDate={rescheduleMax}
                      markedDate={rescheduleNext}
                    />
                    {rescheduleNext && rescheduleMax ? (
                      <p className="text-[11px] text-muted-foreground">
                        Najkasnije {formatDate(rescheduleMax)} — dan pre sledeće uplate (
                        {formatDate(rescheduleNext)}).
                      </p>
                    ) : null}
                  </div>
                  {isRecurring ? (
                    <div className="space-y-2">
                      <Label htmlFor="payment-detail-reschedule-reason">Razlog (opciono)</Label>
                      <Textarea
                        id="payment-detail-reschedule-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="npr. plata kasni ovaj mesec"
                        rows={2}
                      />
                    </div>
                  ) : null}
                </div>
              ) : mode === "cancel" ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">{cancelCopy?.message}</p>
                  <div className="space-y-2">
                    <Label htmlFor="payment-detail-cancel-reason">Razlog (opciono)</Label>
                    <Textarea
                      id="payment-detail-cancel-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={cancelCopy?.placeholder ?? ""}
                      rows={3}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Iznos:</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100">
                        {formatAmount(payment.amount)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Datum dospeća:</dt>
                      <dd className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                        {formatDate(effectiveDue)}
                        {!payment.is_paid && isOverdue(effectiveDue) ? (
                          <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-800/60 dark:text-red-200">
                            Prekoračeno
                          </span>
                        ) : null}
                      </dd>
                    </div>
                    {override?.action === "reschedule" ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500 dark:text-gray-400">Pomereno sa:</dt>
                        <dd className="font-medium text-indigo-600 dark:text-indigo-400">
                          {formatDate(payment.due_date)}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Status:</dt>
                      <dd
                        className={
                          payment.is_paid
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-amber-700 dark:text-amber-400"
                        }
                      >
                        {payment.is_paid ? "Plaćeno" : "Nije plaćeno"}
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
                    {payment.description ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                        <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                          {payment.description}
                        </dd>
                      </div>
                    ) : null}
                    {payment.recurrence_period === "limited" && payment.remaining_occurrences ? (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-400">Preostalo:</dt>
                        <dd className="font-medium text-gray-900 dark:text-gray-100">
                          {payment.remaining_occurrences} rata
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t border-gray-200 pt-2 dark:border-gray-600">
                      <button
                        type="button"
                        className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                        onClick={openHistory}
                      >
                        Istorija
                      </button>
                      {!payment.is_paid ? (
                        <button
                          type="button"
                          className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline disabled:opacity-50 dark:text-blue-400"
                          disabled={saving}
                          onClick={() => {
                            void handleMarkAsPaid();
                          }}
                        >
                          Označi kao plaćeno
                        </button>
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-gray-500" />
                      )}
                    </div>
                  </dl>
                </div>
              )}
            </div>
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
                disabled={saving || !newDate || newDate === effectiveDue}
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
                {cancelCopy?.title ?? "Otkaži ratu"}
              </Button>
            </ResponsiveDialogFooter>
          ) : (
            <ResponsiveDialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex justify-center gap-1 sm:justify-start">
                {override?.action === "reschedule" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void handleRestore();
                    }}
                    disabled={saving}
                  >
                    <ArrowUturnLeftIcon className="mr-1 h-4 w-4" />
                    Vrati
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={openReschedule} disabled={saving}>
                      <CalendarDaysIcon className="mr-1 h-4 w-4" />
                      Pomeri
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 dark:text-red-400"
                      onClick={openCancel}
                      disabled={saving}
                    >
                      <XCircleIcon className="mr-1 h-4 w-4" />
                      Otkaži
                    </Button>
                  </>
                )}
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

      <PaymentHistoryPopup open={historyOpen} onOpenChange={setHistoryOpen} payment={payment} />
    </>
  );
}
