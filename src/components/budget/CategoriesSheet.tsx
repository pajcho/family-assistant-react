import { useState } from "react";
import type { FormEvent } from "react";
import { PencilSquareIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
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
import { Amount } from "@/components/common/Amount";
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
 *
 * The add/edit form and the delete confirm are sub-views on the sheet stack
 * ("← Nazad" header, dismissal returns to the list) — not inline forms or a
 * second dialog.
 */
type View = "list" | "editor" | "delete";
export function CategoriesSheet({ open, onOpenChange }: CategoriesSheetProps) {
  const { categories } = useExpenseCategories();
  const createCategory = useCreateExpenseCategory();
  const updateCategory = useUpdateExpenseCategory();
  const deleteCategory = useDeleteExpenseCategory();

  const { view, atRoot, push, pop, dialogOpen, dialogKey, handleOpenChange } = useSheetStack<View>(
    open,
    onOpenChange,
    "list",
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [toDelete, setToDelete] = useState<ExpenseCategory | null>(null);
  const saving = createCategory.isPending || updateCategory.isPending;

  const openEditor = (initial: EditorState) => {
    setEditor(initial);
    push("editor");
  };

  const openDelete = (category: ExpenseCategory) => {
    setToDelete(category);
    push("delete");
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteCategory.mutateAsync(toDelete.id);
      setToDelete(null);
      pop();
    } catch {
      /* hook toasts */
    }
  };

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
      pop();
    } catch {
      /* hook toasts */
    }
  };

  const showEditor = view === "editor" && editor !== null;
  const showDelete = view === "delete" && toDelete !== null;

  return (
    <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <SheetStackHeader
          title={
            showDelete
              ? "Obriši kategoriju"
              : showEditor
                ? editor.id
                  ? "Izmeni kategoriju"
                  : "Nova kategorija"
                : "Kategorije"
          }
          onBack={atRoot ? undefined : pop}
          backAriaLabel="Nazad na kategorije"
          description={
            showEditor || showDelete
              ? undefined
              : "Preimenuj, oboji i postavi mesečni limit po kategoriji."
          }
        />

        {showDelete ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Da li ste sigurni da želite da obrišete „{toDelete.name}"? Troškovi neće biti obrisani
              — samo ostaju bez kategorije.
            </p>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={deleteCategory.isPending}>
                Nazad
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  void handleDelete();
                }}
                disabled={deleteCategory.isPending}
              >
                Obriši
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : null}

        {!showEditor && !showDelete ? (
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
                        {c.monthly_limit != null ? (
                          <>
                            Limit <Amount value={c.monthly_limit} />
                          </>
                        ) : (
                          "Bez limita"
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Izmeni kategoriju"
                        onClick={() => openEditor(editorFrom(c))}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        <PencilSquareIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Obriši kategoriju"
                        onClick={() => openDelete(c)}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <Button
              type="button"
              variant="outline"
              className="mt-2 w-full"
              onClick={() => openEditor(emptyEditor())}
            >
              <PlusIcon className="mr-2 size-4" />
              Dodaj kategoriju
            </Button>
          </div>
        ) : null}

        {showEditor ? (
          <form onSubmit={handleSave} className="space-y-4">
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

            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" onClick={pop} disabled={saving}>
                Odustani
              </Button>
              <Button type="submit" disabled={saving}>
                {editor.id ? "Sačuvaj" : "Dodaj"}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
