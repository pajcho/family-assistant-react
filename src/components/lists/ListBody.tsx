import * as React from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { ListItemRow } from "@/components/lists/ListItemRow";
import { SwipeableListItem } from "@/components/lists/SwipeableListItem";
import type { ListItem, ListWithItems } from "@/types/database";

export type ListBodyProps = {
  list: ListWithItems;
  onAddItem: (listId: string, name: string) => void;
  onToggleItem: (item: ListItem) => void;
  onRenameItem: (item: ListItem, name: string) => void;
  onDeleteItem: (item: ListItem) => void;
};

/**
 * Shared body for both the grid `ListCard` and the full-page list view.
 * Owns:
 *   • the controlled `draft` for the add-item input
 *   • the show/hide-completed toggle state
 *   • the per-item delete confirmation dialog (so swipe-left and the
 *     desktop trash button both route through the same prompt)
 *
 * Each row is wrapped in `SwipeableListItem` regardless of viewport. The
 * gesture works fine with mouse on desktop; the hidden inline action
 * buttons on mobile (handled inside `ListItemRow`) is what makes the
 * gesture-only UX feel mobile-first without disabling power-user clicks
 * on desktop.
 */
export function ListBody({
  list,
  onAddItem,
  onToggleItem,
  onRenameItem,
  onDeleteItem,
}: ListBodyProps) {
  const [draft, setDraft] = React.useState("");
  const [showCompleted, setShowCompleted] = React.useState(false);

  // Delete-confirm state, used by both swipe-left and the desktop trash button.
  const [pendingDelete, setPendingDelete] = React.useState<ListItem | null>(null);

  const active = list.list_items.filter((i) => !i.is_completed);
  const completed = list.list_items.filter((i) => i.is_completed);

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = draft.trim();
    if (!next) return;
    onAddItem(list.id, next);
    setDraft("");
  };

  const requestDelete = (item: ListItem) => {
    setPendingDelete(item);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    onDeleteItem(pendingDelete);
    setPendingDelete(null);
  };

  return (
    <>
      <div className="px-2 py-2">
        {active.length === 0 ? (
          <p className="px-2 py-2 text-sm text-gray-500 dark:text-gray-400">
            {completed.length === 0
              ? "Lista je prazna. Dodajte prvu stavku ispod."
              : "Sve stavke su završene."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {active.map((item) => (
              <SwipeableListItem
                key={item.id}
                onSwipeRight={() => onToggleItem(item)}
                onSwipeLeft={() => requestDelete(item)}
              >
                <ListItemRow
                  item={item}
                  onToggle={onToggleItem}
                  onRename={onRenameItem}
                  onDelete={requestDelete}
                />
              </SwipeableListItem>
            ))}
          </ul>
        )}

        {completed.length > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowCompleted((s) => !s)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
            >
              {showCompleted ? (
                <ChevronUpIcon className="h-3.5 w-3.5" />
              ) : (
                <ChevronDownIcon className="h-3.5 w-3.5" />
              )}
              {showCompleted ? "Sakrij završene" : `Prikaži završene (${completed.length})`}
            </button>
            {showCompleted ? (
              <ul className="mt-1 space-y-0.5">
                {completed.map((item) => (
                  <SwipeableListItem
                    key={item.id}
                    onSwipeRight={() => onToggleItem(item)}
                    onSwipeLeft={() => requestDelete(item)}
                  >
                    <ListItemRow
                      item={item}
                      onToggle={onToggleItem}
                      onRename={onRenameItem}
                      onDelete={requestDelete}
                    />
                  </SwipeableListItem>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleAdd}
        className="flex items-center gap-2 border-t border-gray-100 px-3 py-2 dark:border-gray-700"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Dodaj stavku…"
          className="h-9 flex-1"
          aria-label={`Dodaj stavku u "${list.name}"`}
        />
        <Button type="submit" size="icon-sm" disabled={!draft.trim()} aria-label="Dodaj">
          <PlusIcon className="h-4 w-4" />
        </Button>
      </form>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Obriši stavku"
        message={pendingDelete ? `Obrisati stavku "${pendingDelete.name}"?` : ""}
        onConfirm={confirmDelete}
      />
    </>
  );
}
