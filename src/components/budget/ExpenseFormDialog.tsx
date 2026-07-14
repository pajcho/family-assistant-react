import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ExpenseForm, type ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import type { Expense } from "@/types/database";

export type ExpenseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; null when adding. */
  expense?: Expense | null;
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ExpenseFormPayload) => void;
};

/**
 * Drawer (mobile) / modal (desktop) shell around <ExpenseForm> — the "Dodaj
 * trošak" quick-add and the edit form for manual expenses share it.
 */
export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
  error,
  saving,
  onSubmit,
}: ExpenseFormDialogProps) {
  const isEdit = !!expense?.id;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEdit ? "Izmeni trošak" : "Dodaj trošak"}</ResponsiveDialogTitle>
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
          expense={expense}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
