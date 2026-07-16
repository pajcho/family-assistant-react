import { Fragment, useEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import {
  BanknotesIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  XCircleIcon,
  ArrowUturnLeftIcon,
  EllipsisVerticalIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/cn";
import { PaymentHistoryPopup } from "@/components/payments/PaymentHistoryPopup";
import { PaymentLinkChip } from "@/components/payments/PaymentLinkChip";
import { LinkedEntityEditor } from "@/components/payments/LinkedEntityEditor";
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
import { usePaymentLinkTarget, type PaymentLinkTarget } from "@/hooks/usePaymentLinks";
import type { Payment } from "@/types/database";
import { formatDate, isOverdue, subtractDay } from "@/utils/date";
import { Amount } from "@/components/common/Amount";
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
  /**
   * "agenda" (default) — the lean dashboard popup (mark paid / reschedule /
   * cancel / edit). "manage" — the /payments surface: adds pause-resume and
   * delete so the list rows can drop their inline buttons entirely.
   */
  variant?: "agenda" | "manage";
};

type Mode = "detail" | "reschedule" | "cancel" | "delete";

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
  variant = "agenda",
}: PaymentDetailDialogProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("detail");
  const [newDate, setNewDate] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [linkEditTarget, setLinkEditTarget] = useState<PaymentLinkTarget | null>(null);
  // Mobile-only action sheet behind the kebab (desktop keeps the anchored
  // dropdown — a pointer is precise, a thumb is not).
  const [actionsOpen, setActionsOpen] = useState(false);
  const isDesktop = useIsDesktop();

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
  const cancelOverrideActive = override?.action === "cancel";
  // The single mark-paid affordance is hidden once the occurrence is resolved
  // (paid), on hold (paused), or soft-canceled — you'd resume / restore first.
  const canMarkPaid = !!payment && !payment.is_paid && !payment.is_paused && !cancelOverrideActive;
  // Pause/resume + delete only surface on the /payments management variant.
  const canPause =
    variant === "manage" && !!payment && !payment.is_paid && isRecurring && !cancelOverrideActive;
  const saving =
    markPaid.isPending ||
    updatePayment.isPending ||
    upsertOverride.isPending ||
    deleteOverride.isPending ||
    cancelOccurrence.isPending ||
    togglePause.isPending ||
    deletePayment.isPending;

  // Reset to the detail view whenever the dialog closes or the payment changes.
  useEffect(() => {
    if (!open) {
      setMode("detail");
      setActionsOpen(false);
    }
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

  // "Povezano sa" tap — close this popup and open the linked entity's edit
  // form right here (LinkedEntityEditor), no navigation.
  const handleOpenLink = () => {
    if (!linkTarget) return;
    onOpenChange(false);
    setLinkEditTarget(linkTarget);
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

  const openDelete = () => setMode("delete");

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
  const title =
    mode === "reschedule"
      ? "Pomeri ratu"
      : mode === "cancel"
        ? (cancelCopy?.title ?? "Otkaži ratu")
        : mode === "delete"
          ? "Obriši plaćanje"
          : "Detalji plaćanja";

  // Action hierarchy (Todoist / Google Calendar pattern): ONE contextual
  // primary action pinned in the footer, "Izmeni" beside it, everything else
  // behind the kebab — destructive last, separated. The kebab carries the
  // occurrence actions only in the normal state; override/paused states put
  // their single state-fixing action in the primary slot instead.
  const overrideActive = cancelOverrideActive || override?.action === "reschedule";
  const showOccurrenceActions = !!payment && !overrideActive && !payment.is_paused;

  // One list feeds both surfaces: the desktop dropdown and the mobile action
  // sheet (bigger tap targets than an anchored menu on a phone).
  type ActionItem = {
    key: string;
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    destructive?: boolean;
    separatorBefore?: boolean;
    onSelect: () => void;
  };
  const actionItems: ActionItem[] = [];
  if (showOccurrenceActions) {
    actionItems.push({
      key: "reschedule",
      label: "Pomeri datum dospeća",
      icon: CalendarDaysIcon,
      onSelect: openReschedule,
    });
    if (canPause) {
      actionItems.push({
        key: "pause",
        label: "Pauziraj ponavljanje",
        icon: PauseIcon,
        onSelect: () => {
          void handleTogglePause();
        },
      });
    }
    actionItems.push({
      key: "cancel",
      label: cancelCopy?.title ?? "Otkaži ratu",
      icon: XCircleIcon,
      onSelect: openCancel,
    });
  }
  if (variant === "manage") {
    actionItems.push({
      key: "delete",
      label: "Obriši plaćanje",
      icon: TrashIcon,
      destructive: true,
      separatorBefore: actionItems.length > 0,
      onSelect: openDelete,
    });
  }

  const statusBadges: { label: string; className: string }[] = [];
  if (payment) {
    if (cancelOverrideActive) {
      statusBadges.push({
        label: "Otkazano",
        className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      });
    } else if (payment.is_paid) {
      statusBadges.push({
        label: payment.paid_date ? `Plaćeno ${formatDate(payment.paid_date)}` : "Plaćeno",
        className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
      });
    } else if (payment.is_paused) {
      statusBadges.push({
        label: "Pauzirano",
        className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
      });
    } else if (isOverdue(effectiveDue)) {
      statusBadges.push({
        label: "Prekoračeno",
        className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      });
    }
    statusBadges.push({
      label: `${!payment.is_paid && isOverdue(effectiveDue) ? "Dospelo" : "Dospeva"} ${formatDate(effectiveDue)}`,
      className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    });
    if (override?.action === "reschedule") {
      statusBadges.push({
        label: `Pomereno sa ${formatDate(payment.due_date)}`,
        className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
      });
    }
  }

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className={mode === "detail" ? "sr-only" : undefined}>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {payment ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                  <BanknotesIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {payment.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {paymentSubtitle(payment)}
                  </p>
                </div>
                {mode === "detail" && actionItems.length > 0 ? (
                  isDesktop ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Više opcija"
                          className="shrink-0 text-gray-500 dark:text-gray-400"
                          disabled={saving}
                        >
                          <EllipsisVerticalIcon className="size-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        {actionItems.map((item) => (
                          <Fragment key={item.key}>
                            {item.separatorBefore ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuItem
                              variant={item.destructive ? "destructive" : "default"}
                              onClick={item.onSelect}
                              disabled={saving}
                            >
                              <item.icon className="size-4" />
                              {item.label}
                            </DropdownMenuItem>
                          </Fragment>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Više opcija"
                      className="shrink-0 text-gray-500 dark:text-gray-400"
                      disabled={saving}
                      onClick={() => setActionsOpen(true)}
                    >
                      <EllipsisVerticalIcon className="size-5" />
                    </Button>
                  )
                ) : null}
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
              ) : mode === "delete" ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Da li ste sigurni da želite da obrišete „{payment.name}"? Ova radnja se ne može
                  opozvati.
                </p>
              ) : (
                <>
                  {/* The bill's hero: amount first, state as badges. */}
                  <div>
                    <div className="text-3xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
                      <Amount value={payment.amount} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {statusBadges.map((badge) => (
                        <span
                          key={badge.label}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="divide-y divide-gray-100 border-t border-gray-100 text-sm dark:divide-gray-700/60 dark:border-gray-700/60">
                    {personIds.length > 0 ? (
                      <div className="flex items-center justify-between gap-3 py-2.5">
                        <span className="text-gray-500 dark:text-gray-400">Za</span>
                        <MemberBadges personIds={personIds} />
                      </div>
                    ) : null}
                    {linkTarget ? (
                      <div className="flex items-center justify-between gap-3 py-2.5">
                        <span className="shrink-0 text-gray-500 dark:text-gray-400">
                          Povezano sa
                        </span>
                        <span className="min-w-0">
                          <PaymentLinkChip target={linkTarget} onClick={handleOpenLink} />
                        </span>
                      </div>
                    ) : null}
                    {payment.description ? (
                      <div className="flex items-baseline justify-between gap-3 py-2.5">
                        <span className="shrink-0 text-gray-500 dark:text-gray-400">Opis</span>
                        <span className="text-right font-medium text-gray-900 dark:text-gray-100">
                          {payment.description}
                        </span>
                      </div>
                    ) : null}
                    {payment.recurrence_period === "limited" && payment.remaining_occurrences ? (
                      <div className="flex items-center justify-between gap-3 py-2.5">
                        <span className="text-gray-500 dark:text-gray-400">Preostalo</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {payment.remaining_occurrences} rata
                        </span>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={openHistory}
                      className="flex w-full items-center gap-2 py-2.5 text-sm font-medium text-gray-900 transition-colors hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:text-gray-100 dark:hover:text-blue-400"
                    >
                      <ClockIcon className="size-4 text-gray-400 dark:text-gray-500" />
                      Istorija plaćanja
                      <ChevronRightIcon className="ml-auto size-4 text-gray-400 dark:text-gray-500" />
                    </button>
                  </div>
                </>
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
          ) : mode === "delete" ? (
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={() => setMode("detail")} disabled={saving}>
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
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={handleEdit}
                disabled={saving}
              >
                Izmeni
              </Button>
              {/* Contextual primary slot: the one state-fixing action for the
                  occurrence's current state, always in the thumb zone. */}
              {overrideActive ? (
                <Button
                  className="flex-[1.4] sm:flex-none"
                  onClick={() => {
                    void handleRestore();
                  }}
                  disabled={saving}
                >
                  <ArrowUturnLeftIcon className="size-4" />
                  {cancelOverrideActive
                    ? isRecurring
                      ? "Vrati ratu"
                      : "Vrati plaćanje"
                    : "Vrati datum"}
                </Button>
              ) : payment?.is_paused ? (
                variant === "manage" ? (
                  <Button
                    className="flex-[1.4] sm:flex-none"
                    onClick={() => {
                      void handleTogglePause();
                    }}
                    disabled={saving}
                  >
                    <PlayIcon className="size-4" />
                    Nastavi ponavljanje
                  </Button>
                ) : null
              ) : payment?.is_paid ? (
                <span className="inline-flex h-9 flex-[1.4] items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 sm:flex-none dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                  <CheckIcon className="size-4" />
                  Plaćeno
                </span>
              ) : canMarkPaid ? (
                <Button
                  className="flex-[1.4] bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-none dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  onClick={() => {
                    void handleMarkAsPaid();
                  }}
                  disabled={saving}
                >
                  <CheckIcon className="size-4" />
                  Označi kao plaćeno
                </Button>
              ) : null}
            </ResponsiveDialogFooter>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Mobile action sheet — stacks over the detail drawer; the detail stays
          open underneath, so picking "Pomeri"/"Otkaži" lands straight in the
          inline sub-mode. */}
      {!isDesktop ? (
        <Drawer open={actionsOpen} onOpenChange={setActionsOpen}>
          <DrawerContent>
            <DrawerHeader className="pb-1">
              <DrawerTitle className="text-left text-lg leading-none">Opcije</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pt-1 pb-8">
              {actionItems.map((item) => (
                <Fragment key={item.key}>
                  {item.separatorBefore ? (
                    <div className="my-1.5 h-px bg-gray-100 dark:bg-gray-700/60" />
                  ) : null}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setActionsOpen(false);
                      item.onSelect();
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-3 text-[15px] font-medium transition-colors disabled:opacity-50",
                      item.destructive
                        ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                        : "text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/40",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-5",
                        !item.destructive && "text-gray-400 dark:text-gray-500",
                      )}
                    />
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}

      <PaymentHistoryPopup open={historyOpen} onOpenChange={setHistoryOpen} payment={payment} />

      <LinkedEntityEditor target={linkEditTarget} onClose={() => setLinkEditTarget(null)} />
    </>
  );
}
