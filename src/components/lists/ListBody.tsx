import * as React from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { ListItemRow } from "@/components/lists/ListItemRow";
import { SwipeableListItem } from "@/components/lists/SwipeableListItem";
import { CATEGORY_LABEL, groupByCategory } from "@/hooks/useSmartSort";
import type { ListItem, ListWithItems } from "@/types/database";

export type ListBodyProps = {
  list: ListWithItems;
  onAddItem: (listId: string, name: string) => void;
  onToggleItem: (item: ListItem) => void;
  onRenameItem: (item: ListItem, name: string) => void;
  onDeleteItem: (item: ListItem) => void;
  /**
   * When true, the renderer groups active items under their category
   * header. We trust the flag rather than re-checking that items are
   * actually grouped: `useCreateListItem` / `useUpdateListItem` auto-
   * resort whenever this is on, so the items in the cache are always in
   * aisle order by the time we render. The grid card on /lists keeps
   * this off to stay compact.
   */
  showCategoryHeaders?: boolean;
};

/**
 * Shared body for both the grid `ListCard` and the full-page list view.
 * Owns:
 *   • the controlled `draft` for the add-item input
 *   • the show/hide-completed toggle state
 *   • the per-item delete confirmation dialog (so swipe-left and the
 *     desktop trash button both route through the same prompt)
 *   • optional inline category headers (post-smart-sort visualisation)
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
  showCategoryHeaders = false,
}: ListBodyProps) {
  const [draft, setDraft] = React.useState("");
  const [showCompleted, setShowCompleted] = React.useState(false);

  // Delete-confirm state, used by both swipe-left and the desktop trash button.
  const [pendingDelete, setPendingDelete] = React.useState<ListItem | null>(null);

  const active = list.list_items.filter((i) => !i.is_completed);
  const completed = list.list_items.filter((i) => i.is_completed);

  // Categorise active items only. Completed items are tucked away under
  // the collapse and don't need to participate in category grouping —
  // a "Voće i povrće" header above a single struck-through "Jabuke" entry
  // would just be visual noise. Items are guaranteed to be in category
  // order whenever `showCategoryHeaders` is on (the parent list's
  // `smart_sort_enabled` flag drives auto-resort on every change).
  const activeGroups = React.useMemo(
    () => (showCategoryHeaders ? groupByCategory(active) : null),
    [showCategoryHeaders, active],
  );

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

  /** Wraps a single item row with its swipe gesture handlers. */
  const renderRow = (item: ListItem) => (
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
  );

  return (
    <>
      <div className="px-2 py-2">
        {active.length === 0 ? (
          <p className="px-2 py-2 text-sm text-gray-500 dark:text-gray-400">
            {completed.length === 0
              ? "Lista je prazna. Dodajte prvu stavku ispod."
              : "Sve stavke su završene."}
          </p>
        ) : activeGroups ? (
          // Headers branch — a fresh `<ul>` per category so the headings
          // sit between sibling lists rather than as fake list items
          // (cleaner for assistive tech).
          <CategorizedItems groups={activeGroups} renderRow={renderRow} />
        ) : (
          <ul className="space-y-0.5">{active.map((item) => renderRow(item))}</ul>
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
              <ul className="mt-1 space-y-0.5">{completed.map((item) => renderRow(item))}</ul>
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

/**
 * Render categorised items with inline group headers. Receives the
 * already-grouped data from `groupByCategory` (we do that work in a
 * memo upstream so the grouping isn't recomputed on every render).
 */
function CategorizedItems({
  groups,
  renderRow,
}: {
  groups: ReturnType<typeof groupByCategory>;
  renderRow: (item: ListItem) => React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.category}>
          <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {CATEGORY_LABEL[g.category]}
          </h3>
          <ul className="space-y-0.5">{g.items.map((item) => renderRow(item))}</ul>
        </div>
      ))}
    </div>
  );
}
