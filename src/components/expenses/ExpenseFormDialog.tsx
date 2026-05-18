import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ExpenseForm, type ExpenseFormPayload } from "@/components/expenses/ExpenseForm";
import type { Expense } from "@/types/database";

export type ExpenseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: Expense | null;
  /** Inline error banner shown above the form (e.g. mutation failure). */
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ExpenseFormPayload) => void;
};

/**
 * Direct port of `components/expenses/ExpenseFormDialog.vue`.
 *
 * Owns the ResponsiveDialog shell + inline error banner. The form fields
 * and footer buttons live inside <ExpenseForm> so the dialog stays purely
 * about presentation; the parent page wires submit → mutation.
 *
 * On mobile (<sm) this becomes a bottom-sheet via vaul with the grey
 * drag-handle pill (see screenshot 07-expense-dialog-mobile.png); on
 * desktop it's a centered modal. See `src/components/ui/responsive-dialog.tsx`.
 */
export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
  error,
  saving,
  onSubmit,
}: ExpenseFormDialogProps) {
  const title = expense ? "Izmeni trošak" : "Dodaj trošak";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {error ? (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : null}
        <ExpenseForm
          expense={expense}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
