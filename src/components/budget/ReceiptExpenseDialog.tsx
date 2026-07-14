import { useEffect, useState } from "react";
import { ArrowTopRightOnSquareIcon, TrashIcon } from "@heroicons/react/24/outline";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useExpenseItems, useUpdateExpense } from "@/hooks/useExpenses";
import type { Expense } from "@/types/database";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { formatAmount } from "@/utils/format";
import { cn } from "@/lib/cn";

/**
 * Detail + recategorize surface for a scanned-receipt expense. Amount and date
 * are read-only (they come from the fiscal receipt, like auto-payment rows),
 * but category / person / note are editable — the same "recategorize an
 * automatic row" affordance payments get. Shows the parsed line items (loaded
 * lazily) and a link to open the original receipt on suf.purs.gov.rs.
 */

export type ReceiptExpenseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: Expense | null;
  /** Hands the delete off to the page's shared confirm dialog. */
  onRequestDelete?: (expense: Expense) => void;
};

function formatDate(spentOn: string): string {
  const [y, m, d] = spentOn.split("-");
  if (!y || !m || !d) return spentOn;
  return `${d}.${m}.${y}.`;
}

export function ReceiptExpenseDialog({
  open,
  onOpenChange,
  expense,
  onRequestDelete,
}: ReceiptExpenseDialogProps) {
  const { categories } = useExpenseCategories();
  const { members } = useFamilyMembers();
  const updateExpense = useUpdateExpense();
  const { items, isLoading: itemsLoading } = useExpenseItems(open && expense ? expense.id : null);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset the editable fields whenever a different expense opens.
  useEffect(() => {
    if (expense) {
      setCategoryId(expense.category_id);
      setPersonId(expense.person_id);
      setNote(expense.note ?? "");
      setError(null);
    }
  }, [expense]);

  const handleSave = async () => {
    if (!expense) return;
    setError(null);
    try {
      await updateExpense.mutateAsync({
        id: expense.id,
        payload: { category_id: categoryId, person_id: personId, note: note.trim() || null },
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Greška pri čuvanju izmena");
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{expense?.merchant || "Račun"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            Detalji skeniranog računa — iznos je fiksan, kategoriju i belešku možeš izmeniti.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {expense ? (
          <div className="space-y-5">
            {/* Amount (read-only) + date. */}
            <div className="text-center">
              <div className="text-4xl font-semibold tabular-nums text-gray-900 dark:text-white">
                {formatAmount(expense.amount)}
              </div>
              <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {formatDate(expense.spent_on)}
              </div>
              {expense.receipt_url ? (
                <a
                  href={expense.receipt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Otvori račun
                  <ArrowTopRightOnSquareIcon className="size-4" />
                </a>
              ) : null}
            </div>

            {/* Category (editable). */}
            <div className="space-y-2">
              <Label>Kategorija</Label>
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nema kategorija.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {categories.map((c) => {
                    const selected = categoryId === c.id;
                    const Icon = categoryIcon(c.icon);
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setCategoryId(selected ? null : c.id)}
                        aria-pressed={selected}
                        style={
                          selected
                            ? { backgroundColor: `${c.color}1F`, borderColor: c.color }
                            : undefined
                        }
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
                          selected
                            ? "text-gray-900 dark:text-gray-100"
                            : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
                        )}
                      >
                        <Icon className="size-5 shrink-0" style={{ color: c.color }} />
                        <span className="w-full truncate text-[11px] leading-tight">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Items (read-only, lazy). */}
            <div className="space-y-2">
              <Label>Stavke</Label>
              {itemsLoading ? (
                <p className="text-sm text-muted-foreground">Učitavam stavke…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nema prepoznatih stavki.</p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">
                        {it.name}
                      </span>
                      {it.quantity != null && it.quantity !== 1 ? (
                        <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                          ×{it.quantity}
                        </span>
                      ) : null}
                      <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
                        {formatAmount(it.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Person (editable). */}
            {members.length > 0 ? (
              <div className="space-y-2">
                <Label>Za koga (opciono)</Label>
                <div className="flex flex-wrap gap-2">
                  {members.map((person) => {
                    const selected = personId === person.id;
                    const color = person.color ?? fallbackColorForProfile(person.id);
                    const name =
                      getDisplayName({
                        firstName: person.first_name,
                        lastName: person.last_name,
                        email: null,
                      }) || "Bez imena";
                    return (
                      <button
                        type="button"
                        key={person.id}
                        onClick={() => setPersonId(selected ? null : person.id)}
                        aria-pressed={selected}
                        style={
                          selected
                            ? { backgroundColor: `${color}1F`, borderColor: color }
                            : undefined
                        }
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
                          selected
                            ? "text-gray-900 dark:text-gray-100"
                            : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
                        )}
                      >
                        <span
                          className="inline-block size-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Note (editable). */}
            <div className="space-y-2">
              <Label htmlFor="receipt-detail-note">Beleška</Label>
              <Input
                id="receipt-detail-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="npr. nedeljna kupovina"
              />
            </div>

            {error ? (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 pt-1">
              {onRequestDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                  disabled={updateExpense.isPending}
                  onClick={() => onRequestDelete(expense)}
                >
                  <TrashIcon className="size-4" />
                  Obriši
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={updateExpense.isPending}
                >
                  Zatvori
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={updateExpense.isPending}
                >
                  {updateExpense.isPending ? "Čuvam…" : "Sačuvaj izmene"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
