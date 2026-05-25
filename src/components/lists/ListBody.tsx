import * as React from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@heroicons/react/24/outline";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { ListItemDialog, type ListItemDialogPayload } from "@/components/lists/ListItemDialog";
import { ListItemRow, type DragHandleBindings } from "@/components/lists/ListItemRow";
import { SwipeableListItem } from "@/components/lists/SwipeableListItem";
import { useReorderListItems } from "@/hooks/useLists";
import { CATEGORY_LABEL, groupByCategory } from "@/hooks/useSmartSort";
import type { ListItem, ListWithItems } from "@/types/database";

export type ListBodyProps = {
  list: ListWithItems;
  onAddItem: (listId: string, name: string) => void;
  onToggleItem: (item: ListItem) => void;
  /**
   * Apply edits from the item popup (name + optional description).
   * Replaces the old `onRenameItem` — the same callback now ferries the
   * whole payload so the parent doesn't need separate rename / update
   * paths.
   */
  onUpdateItem: (item: ListItem, payload: ListItemDialogPayload) => void;
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
  onUpdateItem,
  onDeleteItem,
  showCategoryHeaders = false,
}: ListBodyProps) {
  const [draft, setDraft] = React.useState("");
  const [showCompleted, setShowCompleted] = React.useState(false);

  // Delete-confirm state, used by both swipe-left and the desktop trash button.
  const [pendingDelete, setPendingDelete] = React.useState<ListItem | null>(null);

  // Item-popup state. When non-null the `ListItemDialog` is open and renders
  // the editor for this item. The popup replaces the previous inline rename
  // affordance — tapping any row's text or its pencil icon flips this on.
  const [editingItem, setEditingItem] = React.useState<ListItem | null>(null);

  // Keep the dialog's `item` in sync with realtime updates: if the cache
  // refetches (e.g. someone else edits the same item) we want the popup to
  // reflect the latest server state instead of stale fields the user
  // opened the dialog with. We match by id and refresh the local pointer.
  React.useEffect(() => {
    if (!editingItem) return;
    const fresh = list.list_items.find((it) => it.id === editingItem.id);
    if (!fresh) {
      // Item was deleted (locally or remotely) — close the popup.
      setEditingItem(null);
      return;
    }
    if (fresh !== editingItem) {
      setEditingItem(fresh);
    }
  }, [list.list_items, editingItem]);

  // When the user ticks an item, the optimistic update in `useUpdateListItem`
  // flips is_completed → true immediately, which would otherwise yank the row
  // out of the active list with no visual confirmation. We keep the id here
  // for ~600ms so the row stays in the active section (now rendered with the
  // strike-through styling driven by is_completed) before sliding into the
  // collapsed completed section. Pure presentation; the mutation still fires
  // straight away so persistence and remote sync are unaffected.
  const [pendingHideIds, setPendingHideIds] = React.useState<Set<string>>(() => new Set());
  const hideTimersRef = React.useRef<Map<string, number>>(new Map());

  React.useEffect(() => {
    return () => {
      for (const handle of hideTimersRef.current.values()) {
        window.clearTimeout(handle);
      }
      hideTimersRef.current.clear();
    };
  }, []);

  const handleToggle = (item: ListItem) => {
    const becomingCompleted = !item.is_completed;
    const existing = hideTimersRef.current.get(item.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      hideTimersRef.current.delete(item.id);
    }
    if (becomingCompleted) {
      setPendingHideIds((prev) => {
        if (prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      const handle = window.setTimeout(() => {
        setPendingHideIds((prev) => {
          if (!prev.has(item.id)) return prev;
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        hideTimersRef.current.delete(item.id);
      }, 600);
      hideTimersRef.current.set(item.id, handle);
    } else {
      // Un-checking from the completed section — drop any leftover hide
      // entry so the item doesn't double-render.
      setPendingHideIds((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
    onToggleItem(item);
  };

  const active = list.list_items.filter((i) => !i.is_completed || pendingHideIds.has(i.id));
  const completed = list.list_items.filter((i) => i.is_completed && !pendingHideIds.has(i.id));

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
      onSwipeRight={() => handleToggle(item)}
      onSwipeLeft={() => requestDelete(item)}
    >
      <ListItemRow
        item={item}
        onToggle={handleToggle}
        onOpen={(it) => setEditingItem(it)}
        onDelete={requestDelete}
      />
    </SwipeableListItem>
  );

  // ---------------------------------------------------------------------------
  // Drag-to-reorder
  // ---------------------------------------------------------------------------
  // Available only when smart sort is OFF — when smart sort is on the
  // visual order is derived from category, so manual drag would either
  // be discarded by the next render or surprise the user.
  //
  // The drag handle lives inside `ListItemRow`; only the active section
  // participates in sorting (completed rows render via plain `renderRow`
  // with no handle).
  const reorderable = !list.smart_sort_enabled;
  const reorderItems = useReorderListItems();

  // PointerSensor with a small activation distance: a quick tap on the
  // handle (e.g. the user adjusting focus) won't start a drag, but any
  // real pull will. Covers both mouse and touch — the pointer events spec
  // unifies them.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragActive, over } = event;
    if (!over || dragActive.id === over.id) return;

    const oldIndex = active.findIndex((i) => i.id === dragActive.id);
    const newIndex = active.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Build the new global order: reordered active items in their new
    // positions, then completed items keeping their relative order. We
    // renumber every row from 1 so sort_order stays dense — completed
    // items therefore get fresh values too, but their visual order in
    // the completed section is preserved.
    const reorderedActive = arrayMove(active, oldIndex, newIndex);
    const finalOrder = [...reorderedActive, ...completed];
    const updates = finalOrder.map((item, idx) => ({ id: item.id, sort_order: idx + 1 }));
    reorderItems.mutate(updates);
  };

  /** Like `renderRow` but with the drag handle wired up through `useSortable`. */
  const renderSortableActiveRow = (item: ListItem) => (
    <SortableActiveRow
      key={item.id}
      item={item}
      onToggle={handleToggle}
      onOpen={(it) => setEditingItem(it)}
      onDelete={requestDelete}
      onSwipeRight={() => handleToggle(item)}
      onSwipeLeft={() => requestDelete(item)}
    />
  );

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) setEditingItem(null);
  };

  const handleDialogSubmit = (item: ListItem, payload: ListItemDialogPayload) => {
    onUpdateItem(item, payload);
    setEditingItem(null);
  };

  // From within the dialog: route through the same confirm flow that
  // swipe-left and the desktop trash button use. We close the popup
  // first so the confirm dialog can take focus over the same spot.
  const handleDialogDelete = (item: ListItem) => {
    setEditingItem(null);
    setPendingDelete(item);
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
        ) : activeGroups ? (
          // Headers branch — a fresh `<ul>` per category so the headings
          // sit between sibling lists rather than as fake list items
          // (cleaner for assistive tech). Drag is intentionally not wired
          // up here because the visual order is derived from category.
          <CategorizedItems groups={activeGroups} renderRow={renderRow} />
        ) : reorderable ? (
          // Sortable flat list — only when smart sort is OFF. We pass
          // active item ids to `SortableContext` and render each row via
          // `SortableActiveRow`, which wires the per-row `useSortable`
          // bindings into the drag handle inside `ListItemRow`.
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={active.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-0.5">{active.map(renderSortableActiveRow)}</ul>
            </SortableContext>
          </DndContext>
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
          // On long lists the add-item input sits at the bottom of a
          // tall scrollable page; iOS Safari doesn't always scroll it
          // above the keyboard on its own. Wait for the keyboard
          // animation to settle (~300ms) so visualViewport reflects
          // the new available area, then explicitly scroll the input
          // into the middle of the visible area.
          onFocus={(e) => {
            const input = e.currentTarget;
            setTimeout(() => {
              input.scrollIntoView({ block: "center", behavior: "smooth" });
            }, 300);
          }}
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

      <ListItemDialog
        item={editingItem}
        onOpenChange={handleDialogOpenChange}
        onSubmit={handleDialogSubmit}
        onDelete={handleDialogDelete}
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

/**
 * Sortable wrapper for one active row. Calls `useSortable` per item and
 * threads the resulting drag bindings into `ListItemRow` via its
 * `dragHandle` prop. The outer `<div>` carries the transform that
 * dnd-kit uses to animate the row during a drag — kept as a div rather
 * than a `<li>` so we don't double up with the `<li>` that
 * `SwipeableListItem` renders internally.
 *
 * SwipeableListItem owns pointer events on touch devices; the drag
 * handle in `ListItemRow` stops `pointerdown` propagation so the swipe
 * gesture doesn't try to interpret a drag pull as a horizontal swipe.
 */
function SortableActiveRow({
  item,
  onToggle,
  onOpen,
  onDelete,
  onSwipeRight,
  onSwipeLeft,
}: {
  item: ListItem;
  onToggle: (item: ListItem) => void;
  onOpen: (item: ListItem) => void;
  onDelete: (item: ListItem) => void;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    // Lift the dragging row above its neighbours so the shadow + outline
    // don't get clipped by sibling rows during the translate animation.
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? "relative" : undefined,
  };
  const dragHandle: DragHandleBindings = { listeners, attributes };

  return (
    <div ref={setNodeRef} style={style}>
      <SwipeableListItem
        onSwipeRight={onSwipeRight}
        onSwipeLeft={onSwipeLeft}
        // Suppress swipe gestures while a drag is in progress — touch
        // devices would otherwise see a long pointer trail as both a
        // drag (via dnd-kit) and a swipe (via SwipeableListItem).
        disabled={isDragging}
      >
        <ListItemRow
          item={item}
          onToggle={onToggle}
          onOpen={onOpen}
          onDelete={onDelete}
          dragHandle={dragHandle}
        />
      </SwipeableListItem>
    </div>
  );
}
