import { useEffect, useRef, useState } from "react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import { useCurrencyAmount } from "@/components/common/CurrencyAmountField";
import { CategoryGridPicker } from "@/components/budget/CategoryGridPicker";
import {
  PaymentForm,
  initialPaymentFormState,
  type PaymentFormPayload,
  type PaymentFormState,
  type PaymentFormViewKind,
} from "@/components/payments/PaymentForm";
import { PaymentDetailsSheet, PaymentTipSheet } from "@/components/payments/PaymentFormSheets";
import type { Payment } from "@/types/database";
import { useToday } from "@/hooks/useToday";

export type PaymentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
  /** Assignees of the payment being edited; empty/omitted when adding. */
  initialPersonIds?: string[];
  /** When the payment already has history, recurrence type radios get disabled. */
  hasHistory?: boolean;
  /** Inline error banner shown above the form (e.g. mutation failure). */
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: PaymentFormPayload) => void;
};

type View = { kind: "form" | PaymentFormViewKind };

/**
 * The "Brzi unos" shell around PaymentForm.
 *
 * Owns three things the form itself must not:
 *   - the SheetStack — the mobile picker rows (Tip plaćanja / Kategorija /
 *     Više detalja) push sub-views into this same sheet, "←" pops back;
 *   - the form state + currency control — lifted here so the SheetStack's
 *     mobile close→reopen hop (which remounts the dialog subtree via
 *     `dialogKey`) can't drop what the user already typed;
 *   - the reseed: state resets on every open and when the edited payment /
 *     its async-loaded assignees change.
 *
 * On desktop (sm+) the form renders fully expanded and none of the sub-views
 * are reachable — the dialog behaves exactly like the pre-redesign one.
 * The parent page still wires submit → mutation.
 */
export function PaymentFormDialog({
  open,
  onOpenChange,
  payment,
  initialPersonIds,
  hasHistory,
  error,
  saving,
  onSubmit,
}: PaymentFormDialogProps) {
  const today = useToday();
  const stack = useSheetStack<View>(open, onOpenChange, { kind: "form" });
  const [form, setForm] = useState<PaymentFormState>(() =>
    initialPaymentFormState(payment, initialPersonIds ?? [], today.str),
  );
  const ca = useCurrencyAmount(payment, form.due_date);
  const { reset: resetCurrency } = ca;
  const { reset: resetStack } = stack;

  // Serialized so the effect reseeds when the assignees finish loading
  // without firing on every render from a fresh array reference.
  const personSeed = (initialPersonIds ?? []).join(",");
  // Read through a ref so a midnight rollover doesn't wipe a form mid-typing.
  const todayRef = useRef(today.str);
  todayRef.current = today.str;

  // The dialog stays mounted at the route level, so state must reseed on
  // every open — and while open, whenever the edited entity itself changes.
  useEffect(() => {
    if (!open) return;
    setForm(
      initialPaymentFormState(payment, personSeed ? personSeed.split(",") : [], todayRef.current),
    );
    resetCurrency(payment?.currency, payment?.exchange_rate);
    resetStack();
  }, [open, payment, personSeed, resetCurrency, resetStack]);

  const title = payment ? "Izmeni plaćanje" : "Dodaj plaćanje";
  const view = stack.view;

  return (
    <ResponsiveDialog
      key={stack.dialogKey}
      open={stack.dialogOpen}
      onOpenChange={stack.handleOpenChange}
    >
      <ResponsiveDialogContent>
        {view.kind === "form" ? (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            {error ? (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            ) : null}
            <PaymentForm
              form={form}
              setForm={setForm}
              ca={ca}
              payment={payment}
              hasHistory={hasHistory}
              saving={saving}
              onSubmit={onSubmit}
              onCancel={() => onOpenChange(false)}
              onOpenView={(kind) => stack.push({ kind })}
            />
          </>
        ) : view.kind === "tip" ? (
          <>
            <SheetStackHeader title="Tip plaćanja" onBack={stack.pop} />
            <PaymentTipSheet
              form={form}
              setForm={setForm}
              hasHistory={!!hasHistory}
              isEdit={!!payment?.id}
            />
          </>
        ) : view.kind === "category" ? (
          <>
            <SheetStackHeader title="Kategorija" onBack={stack.pop} />
            <CategoryGridPicker
              value={form.category_id}
              onChange={(category_id) => {
                setForm((s) => ({ ...s, category_id }));
                // Nothing else to configure here — selection pops right back.
                stack.pop();
              }}
            />
          </>
        ) : (
          <>
            <SheetStackHeader title="Detalji" onBack={stack.pop} />
            <PaymentDetailsSheet form={form} setForm={setForm} isEdit={!!payment?.id} />
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
