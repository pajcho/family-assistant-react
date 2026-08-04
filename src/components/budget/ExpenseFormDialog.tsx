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
import {
  PaymentLinkField,
  paymentLinkSeed,
  parsePaymentLinkSeed,
  type PaymentLinkValue,
} from "@/components/payments/PaymentLinkField";
import { PaymentLinkPickerSheet } from "@/components/payments/PaymentLinkPickerSheet";
import {
  EXPENSE_LINK_KINDS,
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
  /**
   * Add mode only - pre-links the expense ("Dodaj trošak" from an activity
   * detail). Ignored while editing.
   */
  initialLink?: PaymentLinkValue | null;
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ExpenseFormPayload) => void;
  /** When adding, offers a "Skeniraj račun" shortcut into the receipt scanner. */
  onScanReceipt?: () => void;
  /** Confirmed delete of the edited expense (only wired while editing). */
  onDelete?: () => void;
  deleting?: boolean;
};

// "link" is one level deeper than the other sub-views: Detalji → Poveži sa.
type View = { kind: "form" | ExpenseFormViewKind | "delete" | "link" };

/**
 * The "Brzi unos" shell around <ExpenseForm> - same architecture as
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
  initialLink,
  error,
  saving,
  onSubmit,
  onScanReceipt,
  onDelete,
  deleting,
}: ExpenseFormDialogProps) {
  const today = useToday();
  const stack = useSheetStack<View>(open, onOpenChange, { kind: "form" });
  const seedLink = expense ? null : (initialLink ?? null);
  const [form, setForm] = useState<ExpenseFormState>(() => ({
    ...initialExpenseFormState(expense, today.str),
    ...(seedLink ? { link: seedLink } : null),
  }));
  const ca = useCurrencyAmount(expense, form.spent_on);
  const { reset: resetCurrency } = ca;
  const { reset: resetStack } = stack;

  // Serialized so an inline-constructed `initialLink` can't retrigger the
  // reseed below on every render and wipe a form mid-typing.
  const linkSeed = paymentLinkSeed(seedLink);
  // Read through a ref so a midnight rollover doesn't wipe a form mid-typing.
  const todayRef = useRef(today.str);
  todayRef.current = today.str;

  useEffect(() => {
    if (!open) return;
    const link = parsePaymentLinkSeed(linkSeed);
    setForm({
      ...initialExpenseFormState(expense, todayRef.current),
      ...(expense || !link ? null : { link }),
    });
    resetCurrency(expense?.currency, expense?.exchange_rate);
    resetStack();
  }, [open, expense, linkSeed, resetCurrency, resetStack]);

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
            className="text-neg hover:bg-neg-soft hover:text-neg"
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
              <div className="mb-4 rounded-lg bg-neg-soft p-3 text-sm font-semibold text-neg">
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
            />
          </>
        ) : view.kind === "category" ? (
          <>
            <SheetStackHeader title="Kategorija" onBack={stack.pop} />
            <CategoryGridPicker
              value={form.category_id}
              onChange={(category_id) => {
                setForm((s) => ({ ...s, category_id }));
                // Nothing else to configure here - selection pops right back.
                stack.pop();
              }}
            />
          </>
        ) : view.kind === "delete" ? (
          <>
            <SheetStackHeader title="Obriši trošak" onBack={stack.pop} />
            <p className="text-sm text-muted-foreground">
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
        ) : view.kind === "link" ? (
          <>
            <SheetStackHeader title="Poveži sa" onBack={stack.pop} />
            <PaymentLinkPickerSheet
              value={form.link}
              onChange={(link) => setForm((s) => ({ ...s, link }))}
              onDone={stack.pop}
              kinds={EXPENSE_LINK_KINDS}
            />
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
                kinds={EXPENSE_LINK_KINDS}
                // Mobile-only sub-view: full-sheet picker instead of a popover.
                onOpenPicker={() => stack.push({ kind: "link" })}
              />
            </div>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
