import { useState } from "react";
import type { FormEvent } from "react";
import { PencilSquareIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";

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
import type { Income } from "@/types/database";
import { useCreateIncome, useDeleteIncome, useIncomes, useUpdateIncome } from "@/hooks/useIncomes";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { formatAmount } from "@/utils/format";

export type IncomesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const SELECT_CHROME =
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

type EditorState = {
  id: string | null; // null = adding
  name: string;
  amount: string;
  day_of_month: string;
  person_id: string | null;
  active: boolean;
};

function emptyEditor(): EditorState {
  return { id: null, name: "", amount: "", day_of_month: "1", person_id: null, active: true };
}

function editorFrom(income: Income): EditorState {
  return {
    id: income.id,
    name: income.name,
    amount: String(income.amount),
    day_of_month: String(income.day_of_month),
    person_id: income.person_id,
    active: income.active,
  };
}

/**
 * "Prihodi" management — list + add/edit/delete of recurring incomes. Opened
 * from the Budget page's cycle header. Editing/adding happens through one inline
 * form (name, member, amount, pay-day, active).
 */
export function IncomesSheet({ open, onOpenChange }: IncomesSheetProps) {
  const { incomes, totalActive } = useIncomes();
  const { members, byId } = useFamilyMembers();
  const createIncome = useCreateIncome();
  const updateIncome = useUpdateIncome();
  const deleteIncome = useDeleteIncome();

  const [editor, setEditor] = useState<EditorState | null>(null);

  const saving = createIncome.isPending || updateIncome.isPending;

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editor) return;
    const amountNum = Number(editor.amount.replace(",", "."));
    const day = Math.min(31, Math.max(1, Number(editor.day_of_month) || 1));
    if (!editor.name.trim() || !(amountNum > 0)) return;
    const payload = {
      name: editor.name.trim(),
      amount: amountNum,
      day_of_month: day,
      person_id: editor.person_id,
      active: editor.active,
    };
    try {
      if (editor.id) {
        await updateIncome.mutateAsync({ id: editor.id, payload });
      } else {
        await createIncome.mutateAsync(payload);
      }
      setEditor(null);
    } catch {
      /* hook toasts */
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Prihodi</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Mesečni prihodi domaćinstva — ukupno {formatAmount(totalActive)}.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-2">
          {incomes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Još nema prihoda.</p>
          ) : (
            <ul className="space-y-2">
              {incomes.map((income) => {
                const person = income.person_id ? byId.get(income.person_id) : null;
                const color = person
                  ? (person.color ?? fallbackColorForProfile(person.id))
                  : "#9ca3af";
                const personName = person
                  ? getDisplayName({
                      firstName: person.first_name,
                      lastName: person.last_name,
                      email: null,
                    })
                  : null;
                return (
                  <li
                    key={income.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {income.name}
                        </span>
                        {!income.active ? (
                          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                            pauzirano
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        {personName ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="inline-block size-2 rounded-full"
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
                            {personName}
                          </span>
                        ) : null}
                        <span>{income.day_of_month}. u mesecu</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {formatAmount(income.amount)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Izmeni prihod"
                        onClick={() => setEditor(editorFrom(income))}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        <PencilSquareIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Obriši prihod"
                        onClick={() => {
                          void deleteIncome.mutateAsync(income.id).catch(() => {});
                        }}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {editor ? (
            <form
              onSubmit={handleSave}
              className="mt-2 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60"
            >
              <div className="space-y-2">
                <Label htmlFor="income-name">Naziv *</Label>
                <Input
                  id="income-name"
                  value={editor.name}
                  onChange={(e) => setEditor((s) => (s ? { ...s, name: e.target.value } : s))}
                  placeholder="npr. Plata"
                  autoFocus
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="income-amount">Iznos (RSD) *</Label>
                  <Input
                    id="income-amount"
                    value={editor.amount}
                    onChange={(e) => setEditor((s) => (s ? { ...s, amount: e.target.value } : s))}
                    inputMode="decimal"
                    placeholder="0"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="income-day">Dan u mesecu *</Label>
                  <Input
                    id="income-day"
                    value={editor.day_of_month}
                    onChange={(e) =>
                      setEditor((s) => (s ? { ...s, day_of_month: e.target.value } : s))
                    }
                    type="number"
                    min="1"
                    max="31"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="income-person">Član (opciono)</Label>
                <select
                  id="income-person"
                  value={editor.person_id ?? ""}
                  onChange={(e) =>
                    setEditor((s) => (s ? { ...s, person_id: e.target.value || null } : s))
                  }
                  className={SELECT_CHROME}
                >
                  <option value="">Bez člana</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {getDisplayName({
                        firstName: m.first_name,
                        lastName: m.last_name,
                        email: null,
                      }) || "Bez imena"}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={editor.active}
                  onChange={(e) => setEditor((s) => (s ? { ...s, active: e.target.checked } : s))}
                  className="rounded border-gray-300"
                />
                Aktivan
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditor(null)}
                  disabled={saving}
                >
                  Odustani
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {editor.id ? "Sačuvaj" : "Dodaj"}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="mt-2 w-full"
              onClick={() => setEditor(emptyEditor())}
            >
              <PlusIcon className="mr-2 size-4" />
              Dodaj prihod
            </Button>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
