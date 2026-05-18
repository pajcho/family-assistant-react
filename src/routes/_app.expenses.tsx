import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "@heroicons/react/24/outline";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ExpenseFormDialog } from "@/components/expenses/ExpenseFormDialog";
import { ExpenseListItem } from "@/components/expenses/ExpenseListItem";
import type { ExpenseFormPayload } from "@/components/expenses/ExpenseForm";
import {
  useCreateExpense,
  useDeleteExpense,
  useExpensesList,
  useMarkExpensePaid,
  useReorderExpenses,
  useUpdateExpense,
} from "@/hooks/useExpenses";
import type { Expense } from "@/types/database";
import { formatAmount } from "@/utils/format";

export const Route = createFileRoute("/_app/expenses")({
  component: ExpensesPage,
});

function ExpensesPage() {
  const [hidePaid, setHidePaid] = React.useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingExpense, setEditingExpense] = React.useState<Expense | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [expenseToDelete, setExpenseToDelete] = React.useState<Expense | null>(null);

  const expensesQuery = useExpensesList({ hidePaid });
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const markExpensePaid = useMarkExpensePaid();
  const reorderExpenses = useReorderExpenses();

  // Realtime invalidations may swap the array identity, so derive the
  // ordered list directly from query data. dnd-kit's reorder mutation
  // round-trips via the DB so we don't need to track an extra optimistic
  // copy here — the realtime channel re-invalidates within ~1s.
  const expenses: Expense[] = expensesQuery.data ?? [];

  // dnd-kit sensor config: require a 5px drag before activating so taps on
  // the handle don't accidentally start drags (lets the row's other clicks
  // — and importantly, future click-to-edit on the body — still fire).
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const sortableIds = React.useMemo(() => expenses.map((e) => e.id), [expenses]);

  const openAdd = () => {
    setEditingExpense(null);
    setErrorMessage(null);
    setDialogOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setErrorMessage(null);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: ExpenseFormPayload) => {
    setErrorMessage(null);
    try {
      if (editingExpense) {
        await updateExpense.mutateAsync({ id: editingExpense.id, payload });
      } else {
        await createExpense.mutateAsync(payload);
      }
      setDialogOpen(false);
      setEditingExpense(null);
    } catch (err) {
      const fallback = editingExpense
        ? "Greška pri ažuriranju troška"
        : "Greška pri kreiranju troška";
      setErrorMessage(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const handleMarkPaid = async (expense: Expense) => {
    try {
      await markExpensePaid.mutateAsync(expense.id);
    } catch {
      // Toast surfaced by the hook's onError handler.
    }
  };

  const confirmDelete = (expense: Expense) => {
    setExpenseToDelete(expense);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!expenseToDelete) return;
    try {
      await deleteExpense.mutateAsync(expenseToDelete.id);
      setDeleteDialogOpen(false);
      setExpenseToDelete(null);
    } catch {
      // Keep the dialog open so the user can retry.
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingExpense(null);
      setErrorMessage(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = expenses.findIndex((e) => e.id === active.id);
    const newIndex = expenses.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const reordered = arrayMove(expenses, oldIndex, newIndex);
    const updates = reordered.map((item, idx) => ({
      id: item.id,
      sort_order: idx + 1, // 1-indexed to match the Vue source
    }));

    reorderExpenses.mutate(updates);
  };

  const unpaidTotal = React.useMemo(
    () => expenses.filter((e) => !e.is_paid).reduce((sum, e) => sum + Number(e.amount), 0),
    [expenses],
  );

  const deleteConfirmMessage = `Da li ste sigurni da želite da obrišete "${
    expenseToDelete?.name ?? ""
  }"?`;

  const isLoading = expensesQuery.isLoading;
  const showEmpty = !isLoading && expenses.length === 0;

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Planirani troškovi</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={hidePaid}
              onChange={(e) => setHidePaid(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
            />
            Sakrij plaćene
          </label>
          <Button onClick={openAdd}>
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj trošak
          </Button>
        </div>
      </div>

      {!isLoading && unpaidTotal > 0 ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Ukupno neplaćeno: <strong>{formatAmount(unpaidTotal)}</strong>
        </p>
      ) : null}

      {isLoading ? <div className="mt-6 text-gray-500">Učitavanje…</div> : null}

      {showEmpty ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          Nema planiranih troškova za prikaz.
        </div>
      ) : null}

      {!isLoading && expenses.length > 0 ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <ul className="mt-6 space-y-3">
              {expenses.map((expense) => (
                <ExpenseListItem
                  key={expense.id}
                  expense={expense}
                  onMarkPaid={(e) => {
                    void handleMarkPaid(e);
                  }}
                  onEdit={openEdit}
                  onDelete={confirmDelete}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : null}

      <ExpenseFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        expense={editingExpense}
        error={errorMessage}
        saving={createExpense.isPending || updateExpense.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setExpenseToDelete(null);
        }}
        title="Obriši trošak"
        message={deleteConfirmMessage}
        loading={deleteExpense.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />
    </div>
  );
}
