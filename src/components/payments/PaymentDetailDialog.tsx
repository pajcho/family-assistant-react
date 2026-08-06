import { useEffect, useState } from "react";
import {
  ArrowUturnLeftIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  PauseIcon,
  PencilSquareIcon,
  PlayIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { ExchangeRateRow, useCurrencyAmount } from "@/components/common/CurrencyAmountField";
import { DateField } from "@/components/common/DateField";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailHero,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
  type DetailBadge,
} from "@/components/common/DetailSheet";
import { PaymentHistoryList, PaymentUndoConfirm } from "@/components/payments/PaymentHistoryPanel";
import { PaymentLinkChip } from "@/components/payments/PaymentLinkChip";
import {
  LinkedEntityEditor,
  type EditableEntityRef,
} from "@/components/payments/LinkedEntityEditor";
import { MemberBadges } from "@/components/common/MemberBadges";
import {
  useCancelPaymentOccurrence,
  useDeletePayment,
  useMarkPaymentPaid,
  useTogglePaymentPause,
  useUpdatePayment,
} from "@/hooks/usePayments";
import {
  effectivePaymentDueDate,
  overrideKey,
  useDeletePaymentOverride,
  usePaymentOverrides,
  useUpsertPaymentOverride,
} from "@/hooks/usePaymentOverrides";
import { usePaymentLinkTarget } from "@/hooks/usePaymentLinks";
import type { Payment } from "@/types/database";
import { formatDate, isOverdue, subtractDay } from "@/utils/date";
import { Amount } from "@/components/common/Amount";
import {
  formatOriginalAmount,
  formatRateInput,
  parseDecimal,
  sanitizeDecimalInput,
} from "@/utils/currency";
import { nextPaymentOccurrenceDate, paymentCancelCopy, recurrenceLabel } from "@/utils/payment";

/**
 * THE payment detail popup - one look everywhere (agenda, /payments list,
 * linked-money rows). Detalji on top (hero, amount, state badges, info rows),
 * every action below as a visible row (the BlockActionDialog pattern):
 * Izmeni, Istorija, Pomeri, Otkaži, Pauziraj, Obriši and - always last, as
 * the emphasized row - the occurrence's one state action ("Označi kao
 * plaćeno" / "Vrati" / "Nastavi ponavljanje").
 *
 * Self-contained: owns the mutations and a sheet-stack of sub-views (see
 * `useSheetStack`) - reschedule, cancel, confirm-amount, delete, history and
 * the history's undo confirm each open as their own sheet ON TOP of this one,
 * with a "←" back header; dismissing a sub-view returns one level up instead
 * of closing the flow. Reschedule/cancel branch on recurring vs one-time:
 *   - reschedule: recurring → per-occurrence override ("Pomereno"); one-time →
 *     edits `due_date`.
 *   - cancel: recurring → records a canceled history entry + advances to the
 *     next occurrence; one-time → display-only cancel override.
 * "Izmeni" delegates the full form to the caller via `onEdit` when provided;
 * without it the sheet hides itself and opens the form in place
 * (`LinkedEntityEditor`), returning here on close.
 */
export type PaymentDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
  /** Family members the payment is for (from the parent's participants query). */
  personIds?: string[];
  /** Optional edit delegate; omitted → the dialog opens the edit form itself. */
  onEdit?: (payment: Payment) => void;
  /**
   * "full" (default) - the complete action set. "info" - read-only surfaces
   * (e.g. a payment-sourced expense on /budget): no state mutations, just the
   * facts + history + "Izmeni".
   */
  variant?: "full" | "info";
};

type View = "detail" | "reschedule" | "cancel" | "confirm-amount" | "delete" | "history" | "undo";

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
  variant = "full",
}: PaymentDetailDialogProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const [newDate, setNewDate] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [linkEditTarget, setLinkEditTarget] = useState<EditableEntityRef | null>(null);

  const markPaid = useMarkPaymentPaid();
  const updatePayment = useUpdatePayment();
  const upsertOverride = useUpsertPaymentOverride();
  const deleteOverride = useDeletePaymentOverride();
  const cancelOccurrence = useCancelPaymentOccurrence();
  const togglePause = useTogglePaymentPause();
  const deletePayment = useDeletePayment();
  const { byKey: overridesByKey } = usePaymentOverrides();
  const linkTarget = usePaymentLinkTarget(payment);

  const override = payment
    ? (overridesByKey.get(overrideKey(payment.id, payment.due_date)) ?? null)
    : null;
  const effectiveDue = payment
    ? effectivePaymentDueDate(payment.id, payment.due_date, overridesByKey)
    : "";
  const isRecurring =
    !!payment && payment.recurrence_period !== "one-time" && payment.recurrence_period != null;
  // Foreign-currency payment: marking paid confirms the EUR amount + the rate
  // for THIS occurrence (default: today's NBS list - `date: null` resolves to
  // today in useExchangeRate), instead of silently reusing the definition-time
  // conversion.
  const isForeignPayment =
    !!payment && payment.currency !== "RSD" && payment.original_amount != null;
  const rateControl = useCurrencyAmount(
    payment ? { currency: payment.currency, exchange_rate: null } : null,
    null,
  );
  const { reset: resetRate } = rateControl;
  const cancelOverrideActive = override?.action === "cancel";
  // "info" strips every mutation except "Izmeni" - the popup is a viewer.
  const readOnly = variant === "info";
  // The single mark-paid affordance is hidden once the occurrence is resolved
  // (paid), on hold (paused), or soft-canceled - you'd resume / restore first.
  const canMarkPaid =
    !readOnly && !!payment && !payment.is_paid && !payment.is_paused && !cancelOverrideActive;
  const canPause =
    !readOnly && !!payment && !payment.is_paid && isRecurring && !cancelOverrideActive;
  const saving =
    markPaid.isPending ||
    updatePayment.isPending ||
    upsertOverride.isPending ||
    deleteOverride.isPending ||
    cancelOccurrence.isPending ||
    togglePause.isPending ||
    deletePayment.isPending;

  // Back to the root view whenever the subject payment changes underneath
  // (and re-arm the pay-time rate for the new payment's currency).
  useEffect(() => {
    reset();
    resetRate(payment?.currency, null);
  }, [payment, reset, resetRate]);

  // Without an `onEdit` delegate the sheet HIDES (not closes - closing would
  // null the caller's `payment`) and opens the edit form in place; closing
  // the form lands back on this detail sheet.
  const handleEdit = () => {
    if (!payment) return;
    if (onEdit) {
      onOpenChange(false);
      onEdit(payment);
      return;
    }
    setLinkEditTarget({ kind: "payment", id: payment.id });
  };

  // "Povezano sa" tap - same hide trick, editing the linked entity instead.
  const handleOpenLink = () => {
    if (!linkTarget) return;
    setLinkEditTarget(linkTarget);
  };

  const handleMarkAsPaid = async () => {
    if (!payment) return;
    // Variable bills confirm the actual amount, foreign ones the pay-time
    // rate (both through the same sub-view); fixed RSD pays in one tap.
    // Foreign amounts are edited in their ORIGINAL currency.
    if (payment.is_variable_amount || isForeignPayment) {
      setPaidAmount(
        isForeignPayment
          ? payment.original_amount != null
            ? String(payment.original_amount)
            : ""
          : payment.amount != null
            ? String(payment.amount)
            : "",
      );
      push("confirm-amount");
      return;
    }
    try {
      await markPaid.mutateAsync({ id: payment.id });
      onOpenChange(false);
    } catch {
      // Toast surfaced by hook's onError; keep popup open so user can retry.
    }
  };

  const paidAmountNum = parseDecimal(paidAmount);
  const paidAmountValid = paidAmount.trim() !== "" && paidAmountNum > 0;
  const confirmAmountDisabled = isForeignPayment
    ? !(paidAmountValid && rateControl.rateNum > 0)
    : !paidAmountValid;

  const handleConfirmAmount = async () => {
    if (!payment || confirmAmountDisabled) return;
    try {
      if (isForeignPayment) {
        // Freeze THIS occurrence's conversion: EUR amount × confirmed rate.
        const frozen = rateControl.freeze(paidAmountNum);
        if (!frozen) return;
        await markPaid.mutateAsync({ id: payment.id, ...frozen });
      } else {
        await markPaid.mutateAsync({ id: payment.id, amount: paidAmountNum });
      }
      onOpenChange(false);
    } catch {
      // Toast surfaced by hook's onError; keep popup open so user can retry.
    }
  };

  const openReschedule = () => {
    setNewDate(effectiveDue || (payment?.due_date ?? null));
    setReason("");
    push("reschedule");
  };

  const openCancel = () => {
    setReason("");
    push("cancel");
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

  const handleTogglePause = async () => {
    if (!payment) return;
    try {
      await togglePause.mutateAsync(payment.id);
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleDelete = async () => {
    if (!payment) return;
    try {
      await deletePayment.mutateAsync(payment.id);
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const cancelCopy = payment ? paymentCancelCopy(payment) : null;
  const rescheduleNext = payment ? nextPaymentOccurrenceDate(payment) : null;
  const rescheduleMax = rescheduleNext ? subtractDay(rescheduleNext) : null;
  const titleFor = (view: View) =>
    view === "reschedule"
      ? isRecurring
        ? "Pomeri ratu"
        : "Pomeri datum dospeća"
      : view === "cancel"
        ? (cancelCopy?.title ?? "Otkaži ratu")
        : view === "confirm-amount"
          ? isForeignPayment && !payment?.is_variable_amount
            ? "Potvrdi kurs"
            : "Potvrdi iznos"
          : view === "delete"
            ? "Obriši plaćanje"
            : view === "history"
              ? "Istorija plaćanja"
              : view === "undo"
                ? "Poništi plaćanje"
                : "Detalji plaćanja";

  const overrideActive = cancelOverrideActive || override?.action === "reschedule";
  const showOccurrenceActions = !readOnly && !!payment && !overrideActive && !payment.is_paused;

  const statusBadges: DetailBadge[] = [];
  if (payment) {
    if (cancelOverrideActive) {
      statusBadges.push({
        label: "Otkazano",
        tone: "neg",
      });
    } else if (payment.is_paid) {
      statusBadges.push({
        label: payment.paid_date ? `Plaćeno ${formatDate(payment.paid_date)}` : "Plaćeno",
        tone: "pos",
      });
    } else if (payment.is_paused) {
      statusBadges.push({
        label: "Pauzirano",
        tone: "neutral",
      });
    } else if (isOverdue(effectiveDue)) {
      statusBadges.push({
        label: "Prekoračeno",
        tone: "neg",
      });
    }
    statusBadges.push({
      label: `${!payment.is_paid && isOverdue(effectiveDue) ? "Dospelo" : "Dospeva"} ${formatDate(effectiveDue)}`,
      tone: "neutral",
    });
    if (override?.action === "reschedule") {
      statusBadges.push({
        label: `Pomereno sa ${formatDate(payment.due_date)}`,
        tone: "accent",
      });
    }
  }

  const markPaidDescription = payment?.is_variable_amount
    ? "Uz potvrdu iznosa ove uplate"
    : isForeignPayment
      ? "Uz potvrdu kursa na današnji dan"
      : isRecurring
        ? "Beleži uplatu i prelazi na sledeću ratu"
        : "Beleži da je plaćanje izmireno";

  return (
    <>
      <SheetStackViews
        stack={stack}
        hidden={!!linkEditTarget}
        render={(view, level) => (
          <ResponsiveDialogContent>
            <SheetStackHeader
              title={titleFor(view)}
              srOnly={level === 0}
              onBack={level === 0 ? undefined : pop}
            />
            {payment ? (
              <div className="space-y-4">
                {/* Root only: a stacked sub-view sits ON TOP of this sheet, which
                    already names the subject right above it - repeating the hero
                    printed the same title twice on one screen. */}
                {level === 0 ? (
                  <DetailHero
                    icon={BanknotesIcon}
                    tone="warn"
                    title={payment.name}
                    subtitle={paymentSubtitle(payment)}
                  />
                ) : null}

                {view === "reschedule" ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <DateField
                        id="payment-detail-reschedule-date"
                        label="Novi datum"
                        value={newDate}
                        onChange={setNewDate}
                        placeholder="Izaberi datum"
                        maxDate={rescheduleMax}
                      />
                      {rescheduleNext && rescheduleMax ? (
                        <p className="text-[11px] text-muted-foreground">
                          Najkasnije {formatDate(rescheduleMax)} - dan pre sledeće uplate (
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
                ) : view === "cancel" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">{cancelCopy?.message}</p>
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
                ) : view === "confirm-amount" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {payment.is_variable_amount
                        ? `Koliko si uplatio/la za „${payment.name}" ovog meseca?`
                        : `Potvrdi kurs za „${payment.name}" - podrazumevan je srednji kurs NBS na današnji dan.`}
                    </p>
                    <div className="space-y-2">
                      {payment.is_variable_amount ? (
                        <>
                          <Label htmlFor="payment-detail-paid-amount">
                            Iznos ({isForeignPayment ? payment.currency : "RSD"})
                          </Label>
                          <Input
                            id="payment-detail-paid-amount"
                            value={paidAmount}
                            onChange={(e) => setPaidAmount(sanitizeDecimalInput(e.target.value))}
                            inputMode="decimal"
                            autoFocus
                          />
                        </>
                      ) : (
                        // Fixed foreign bill: the amount is contractual - only
                        // the rate gets confirmed. (Fixed RSD never lands here.)
                        <p className="text-sm font-medium text-foreground">
                          Iznos: {formatOriginalAmount(paidAmountNum, payment.currency)}
                        </p>
                      )}
                      {/* Pay-time NBS rate + live RSD preview (foreign only). */}
                      <ExchangeRateRow
                        control={rateControl}
                        amountNum={paidAmountNum}
                        inputId="payment-detail-rate"
                      />
                      {payment.is_variable_amount ? (
                        <p className="text-[11px] text-muted-foreground">
                          Okvirno:{" "}
                          {isForeignPayment && payment.original_amount != null ? (
                            formatOriginalAmount(payment.original_amount, payment.currency)
                          ) : (
                            <Amount value={payment.amount} />
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : view === "delete" ? (
                  <p className="text-sm text-muted-foreground">
                    Da li ste sigurni da želite da obrišete „{payment.name}"? Ova radnja se ne može
                    opozvati.
                  </p>
                ) : view === "history" ? (
                  <PaymentHistoryList payment={payment} onRequestUndo={() => push("undo")} />
                ) : view === "undo" ? (
                  <PaymentUndoConfirm
                    paymentId={payment.id}
                    paymentName={payment.name}
                    onBack={pop}
                    onDone={pop}
                  />
                ) : (
                  <>
                    {/* The bill's hero: amount first, state as badges. */}
                    <div>
                      <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                        <Amount value={payment.amount} />
                      </div>
                      {payment.currency !== "RSD" && payment.original_amount != null ? (
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {formatOriginalAmount(payment.original_amount, payment.currency)}
                          {payment.exchange_rate != null
                            ? ` · kurs ${formatRateInput(payment.exchange_rate)}`
                            : ""}
                        </p>
                      ) : null}
                      {payment.is_variable_amount ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Okvirni iznos - potvrđuje se pri svakom plaćanju
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <DetailBadgeRow badges={statusBadges} />
                      </div>
                    </div>

                    {personIds.length > 0 ||
                    linkTarget ||
                    payment.description ||
                    (payment.recurrence_period === "limited" && payment.remaining_occurrences) ? (
                      <DetailInfoRows>
                        {personIds.length > 0 ? (
                          <DetailInfoRow label="Za">
                            <MemberBadges personIds={personIds} />
                          </DetailInfoRow>
                        ) : null}
                        {linkTarget ? (
                          <DetailInfoRow label="Povezano sa">
                            <span className="min-w-0">
                              <PaymentLinkChip target={linkTarget} onClick={handleOpenLink} />
                            </span>
                          </DetailInfoRow>
                        ) : null}
                        {payment.description ? (
                          <DetailInfoText label="Opis" value={payment.description} />
                        ) : null}
                        {payment.recurrence_period === "limited" &&
                        payment.remaining_occurrences ? (
                          <DetailInfoText
                            label="Preostalo"
                            value={`${payment.remaining_occurrences} rata`}
                          />
                        ) : null}
                      </DetailInfoRows>
                    ) : null}

                    {/* Every action as a visible row; the occurrence's ONE state
                      action (mark paid / restore / resume) OPENS the list as
                      the emphasized first row - the thing you came to do. */}
                    <DetailActionList>
                      {!readOnly && overrideActive ? (
                        <DetailActionRow
                          icon={ArrowUturnLeftIcon}
                          label={
                            cancelOverrideActive
                              ? isRecurring
                                ? "Vrati ratu"
                                : "Vrati plaćanje"
                              : "Vrati datum"
                          }
                          description={
                            cancelOverrideActive
                              ? "Poništava otkazivanje"
                              : "Vraća prvobitni datum dospeća"
                          }
                          onClick={() => {
                            void handleRestore();
                          }}
                          disabled={saving}
                          tone="primary"
                        />
                      ) : !readOnly && payment.is_paused ? (
                        <DetailActionRow
                          icon={PlayIcon}
                          label="Nastavi ponavljanje"
                          description="Rate ponovo dospevaju po rasporedu"
                          onClick={() => {
                            void handleTogglePause();
                          }}
                          disabled={saving}
                          tone="primary"
                        />
                      ) : canMarkPaid ? (
                        <DetailActionRow
                          icon={CheckIcon}
                          label="Označi kao plaćeno"
                          description={markPaidDescription}
                          onClick={() => {
                            void handleMarkAsPaid();
                          }}
                          disabled={saving}
                          tone="primary"
                        />
                      ) : null}
                      <DetailActionRow
                        icon={PencilSquareIcon}
                        label="Izmeni plaćanje"
                        description="Naziv, iznos, ponavljanje, podsetnici…"
                        onClick={handleEdit}
                        disabled={saving}
                      />
                      <DetailActionRow
                        icon={ClockIcon}
                        label="Istorija plaćanja"
                        description="Uplaćene i preskočene rate"
                        onClick={() => push("history")}
                        disabled={saving}
                        chevron
                      />
                      {showOccurrenceActions ? (
                        <>
                          <DetailActionRow
                            icon={CalendarDaysIcon}
                            label={isRecurring ? "Pomeri ratu" : "Pomeri datum dospeća"}
                            description={
                              isRecurring
                                ? "Samo ovu ratu - ostale po rasporedu"
                                : "Promeni datum dospeća plaćanja"
                            }
                            onClick={openReschedule}
                            disabled={saving}
                          />
                          <DetailActionRow
                            icon={XCircleIcon}
                            label={cancelCopy?.title ?? "Otkaži ratu"}
                            description={
                              isRecurring
                                ? "Preskače ovu ratu i prelazi na sledeću"
                                : "Ostaje zabeleženo kao otkazano"
                            }
                            onClick={openCancel}
                            disabled={saving}
                          />
                          {canPause ? (
                            <DetailActionRow
                              icon={PauseIcon}
                              label="Pauziraj ponavljanje"
                              description="Serija miruje dok je ne nastaviš"
                              onClick={() => {
                                void handleTogglePause();
                              }}
                              disabled={saving}
                            />
                          ) : null}
                        </>
                      ) : null}
                      {!readOnly ? (
                        <DetailActionRow
                          icon={TrashIcon}
                          label="Obriši plaćanje"
                          description="Trajno briše plaćanje i istoriju"
                          onClick={() => push("delete")}
                          disabled={saving}
                          tone="destructive"
                        />
                      ) : null}
                    </DetailActionList>
                  </>
                )}
              </div>
            ) : null}

            {view === "reschedule" ? (
              <ResponsiveDialogFooter>
                <Button variant="outline" onClick={pop} disabled={saving}>
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
                  {cancelCopy?.title ?? "Otkaži ratu"}
                </Button>
              </ResponsiveDialogFooter>
            ) : view === "confirm-amount" ? (
              <ResponsiveDialogFooter>
                <Button variant="outline" onClick={pop} disabled={saving}>
                  Nazad
                </Button>
                <Button
                  className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  onClick={() => {
                    void handleConfirmAmount();
                  }}
                  disabled={saving || confirmAmountDisabled}
                >
                  <CheckIcon className="size-4" />
                  Označi kao plaćeno
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
            ) : view === "history" ? (
              <ResponsiveDialogFooter>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={pop}
                  disabled={saving}
                >
                  Nazad
                </Button>
              </ResponsiveDialogFooter>
            ) : null}
          </ResponsiveDialogContent>
        )}
      />

      <LinkedEntityEditor target={linkEditTarget} onClose={() => setLinkEditTarget(null)} />
    </>
  );
}
