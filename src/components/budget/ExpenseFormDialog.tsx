import { useEffect, useRef, useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import { Amount } from "@/components/common/Amount";
import { useCurrencyAmount } from "@/components/common/CurrencyAmountField";
import { CategoryGridPicker } from "@/components/budget/CategoryGridPicker";
import { PaymentLinkField } from "@/components/payments/PaymentLinkField";
import {
  ExpenseForm,
  ExpensePersonSelect,
  initialExpenseFormState,
  type ExpenseFormPayload,
  type ExpenseFormState,
  type ExpenseFormViewKind,
} from "@/components/budget/ExpenseForm";
import type { Expense } from "@/types/database";
import { useToday } from "@/hooks/useToday";

export type ExpenseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; null when adding. */
  expense?: Expense | null;
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ExpenseFormPayload) => void;
  /** When adding, offers a "Skeniraj račun" shortcut into the receipt scanner. */
  onScanReceipt?: () => void;
  /** Confirmed delete of the edited expense (only wired while editing). */
  onDelete?: () => void;
  deleting?: boolean;
};

type View = { kind: "form" | ExpenseFormViewKind | "delete" };

/**
 * The "Brzi unos" shell around <ExpenseForm> — same architecture as
 * PaymentFormDialog: the dialog owns the SheetStack (mobile "Više detalja"
 * row pushes the Detalji sub-view into this same sheet), the form state +
 * currency control (so the SheetStack's mobile close→reopen hop can't drop
 * what the user typed), the reseed on open, and the pinned mobile footer.
 * On desktop the form renders fully expanded, exactly as before.
 */
export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
  error,
  saving,
  onSubmit,
  onScanReceipt,
  onDelete,
  deleting,
}: ExpenseFormDialogProps) {
  const today = useToday();
  const stack = useSheetStack<View>(open, onOpenChange, { kind: "form" });
  const [form, setForm] = useState<ExpenseFormState>(() =>
    initialExpenseFormState(expense, today.str),
  );
  const ca = useCurrencyAmount(expense, form.spent_on);
  const { reset: resetCurrency } = ca;
  const { reset: resetStack } = stack;

  // Read through a ref so a midnight rollover doesn't wipe a form mid-typing.
  const todayRef = useRef(today.str);
  todayRef.current = today.str;
  // Amount autofocus fires once per OPEN, not once per form mount — a return
  // from the Detalji sub-view remounts the form and must not re-pop the
  // keyboard.
  const focusedOnceRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    focusedOnceRef.current = false;
    setForm(initialExpenseFormState(expense, todayRef.current));
    resetCurrency(expense?.currency, expense?.exchange_rate);
    resetStack();
  }, [open, expense, resetCurrency, resetStack]);

  const isEdit = !!expense?.id;
  const view = stack.view;
  const isDesktop = useIsDesktop();

  const mobileFooter =
    !isDesktop && view.kind === "form" ? (
      isEdit ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            onClick={() => stack.push({ kind: "delete" })}
            disabled={saving || deleting}
          >
            <TrashIcon className="size-4" />
            Obriši
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Odustani
            </Button>
            <Button type="submit" form="expense-form" disabled={saving}>
              Sačuvaj izmene
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Odustani
          </Button>
          <Button type="submit" form="expense-form" disabled={saving} className="flex-1">
            Dodaj
          </Button>
        </div>
      )
    ) : undefined;

  return (
    <ResponsiveDialog
      key={stack.dialogKey}
      open={stack.dialogOpen}
      onOpenChange={stack.handleOpenChange}
    >
      <ResponsiveDialogContent stickyFooter={mobileFooter}>
        {view.kind === "form" ? (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {isEdit ? "Izmeni trošak" : "Dodaj trošak"}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                Unesi iznos i izaberi kategoriju troška.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            {error ? (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            ) : null}
            <ExpenseForm
              form={form}
              setForm={setForm}
              ca={ca}
              expense={expense}
              saving={saving}
              onSubmit={onSubmit}
              onCancel={() => onOpenChange(false)}
              onScanReceipt={onScanReceipt}
              onOpenView={(kind) => stack.push({ kind })}
              onRequestDelete={isEdit ? () => stack.push({ kind: "delete" }) : undefined}
              // Editing opens on the existing values — don't yank focus (and the
              // keyboard) onto the amount; that's a quick-ADD affordance only.
              autoFocusAmount={!isEdit && !focusedOnceRef.current}
              onAutoFocusedAmount={() => {
                focusedOnceRef.current = true;
              }}
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
        ) : view.kind === "delete" ? (
          <>
            <SheetStackHeader title="Obriši trošak" onBack={stack.pop} />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Obrisati ovaj trošak (<Amount value={expense?.amount ?? 0} />
              )? Ova radnja se ne može opozvati.
            </p>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={stack.pop} disabled={deleting}>
                Nazad
              </Button>
              <Button variant="destructive" onClick={onDelete} disabled={deleting}>
                {deleting ? "Brišem…" : "Obriši"}
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : (
          <>
            <SheetStackHeader title="Detalji" onBack={stack.pop} />
            <div className="space-y-4">
              <ExpensePersonSelect
                value={form.person_id}
                onChange={(person_id) => setForm((s) => ({ ...s, person_id }))}
              />
              <div className="space-y-2">
                <Label htmlFor="expense-note">Beleška</Label>
                <Input
                  id="expense-note"
                  value={form.note}
                  onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
                  placeholder="npr. pijaca"
                />
              </div>
              <PaymentLinkField
                value={form.link}
                onChange={(link) => setForm((s) => ({ ...s, link }))}
              />
            </div>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
