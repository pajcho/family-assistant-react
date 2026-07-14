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
import {
  CATEGORY_COLORS,
  CATEGORY_ICON_KEYS,
  categoryIcon,
} from "@/components/budget/categoryIcons";
import type { ExpenseCategory } from "@/types/database";
import {
  useCreateExpenseCategory,
  useDeleteExpenseCategory,
  useExpenseCategories,
  useUpdateExpenseCategory,
} from "@/hooks/useExpenseCategories";
import { formatAmount } from "@/utils/format";
import { cn } from "@/lib/cn";

export type CategoriesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type EditorState = {
  id: string | null; // null = adding
  name: string;
  color: string;
  icon: string;
  monthly_limit: string;
};

function emptyEditor(): EditorState {
  return {
    id: null,
    name: "",
    color: CATEGORY_COLORS[0],
    icon: CATEGORY_ICON_KEYS[0],
    monthly_limit: "",
  };
}

function editorFrom(c: ExpenseCategory): EditorState {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
    monthly_limit: c.monthly_limit != null ? String(c.monthly_limit) : "",
  };
}

/**
 * "Kategorije" management — rename / recolor / re-icon / set a monthly limit,
 * plus add and delete. Deleting detaches expenses (category_id → NULL in the DB)
 * rather than removing them.
 */
export function CategoriesSheet({ open, onOpenChange }: CategoriesSheetProps) {
  const { categories } = useExpenseCategories();
  const createCategory = useCreateExpenseCategory();
  const updateCategory = useUpdateExpenseCategory();
  const deleteCategory = useDeleteExpenseCategory();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const saving = createCategory.isPending || updateCategory.isPending;

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editor || !editor.name.trim()) return;
    const limitRaw = editor.monthly_limit.replace(",", ".").trim();
    const limitNum = limitRaw === "" ? null : Number(limitRaw);
    const monthly_limit = limitNum != null && limitNum > 0 ? limitNum : null;
    try {
      if (editor.id) {
        await updateCategory.mutateAsync({
          id: editor.id,
          payload: {
            name: editor.name.trim(),
            color: editor.color,
            icon: editor.icon,
            monthly_limit,
          },
        });
      } else {
        await createCategory.mutateAsync({
          name: editor.name.trim(),
          color: editor.color,
          icon: editor.icon,
          monthly_limit,
        });
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
          <ResponsiveDialogTitle>Kategorije</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Preimenuj, oboji i postavi mesečni limit po kategoriji.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-2">
          <ul className="space-y-2">
            {categories.map((c) => {
              const Icon = categoryIcon(c.icon);
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                >
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${c.color}22` }}
                  >
                    <Icon className="size-4" style={{ color: c.color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {c.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {c.monthly_limit != null
                        ? `Limit ${formatAmount(c.monthly_limit)}`
                        : "Bez limita"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Izmeni kategoriju"
                      onClick={() => setEditor(editorFrom(c))}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                      <PencilSquareIcon className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Obriši kategoriju"
                      onClick={() => {
                        void deleteCategory.mutateAsync(c.id).catch(() => {});
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

          {editor ? (
            <form
              onSubmit={handleSave}
              className="mt-2 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60"
            >
              <div className="space-y-2">
                <Label htmlFor="category-name">Naziv *</Label>
                <Input
                  id="category-name"
                  value={editor.name}
                  onChange={(e) => setEditor((s) => (s ? { ...s, name: e.target.value } : s))}
                  placeholder="npr. Kućni ljubimci"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Boja</Label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_COLORS.map((color) => (
                    <button
                      type="button"
                      key={color}
                      aria-label={`Boja ${color}`}
                      aria-pressed={editor.color === color}
                      onClick={() => setEditor((s) => (s ? { ...s, color } : s))}
                      className={cn(
                        "size-7 rounded-full ring-offset-2 ring-offset-white transition dark:ring-offset-gray-800",
                        editor.color === color ? "ring-2 ring-gray-500" : "",
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Ikonica</Label>
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-10">
                  {CATEGORY_ICON_KEYS.map((key) => {
                    const Icon = categoryIcon(key);
                    const selected = editor.icon === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        aria-label={`Ikonica ${key}`}
                        aria-pressed={selected}
                        onClick={() => setEditor((s) => (s ? { ...s, icon: key } : s))}
                        className={cn(
                          "flex aspect-square items-center justify-center rounded-md border transition-colors",
                          selected
                            ? "border-gray-500 bg-gray-100 dark:border-gray-400 dark:bg-gray-700"
                            : "border-gray-200 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-700",
                        )}
                        style={selected ? { color: editor.color } : undefined}
                      >
                        <Icon className="size-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category-limit">Mesečni limit (RSD, opciono)</Label>
                <Input
                  id="category-limit"
                  value={editor.monthly_limit}
                  onChange={(e) =>
                    setEditor((s) => (s ? { ...s, monthly_limit: e.target.value } : s))
                  }
                  inputMode="decimal"
                  placeholder="npr. 30000"
                />
              </div>

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
              Dodaj kategoriju
            </Button>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
