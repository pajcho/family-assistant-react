import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDoubleDownIcon, ChevronDoubleUpIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ListCard } from "@/components/lists/ListCard";
import { ListFormDialog } from "@/components/lists/ListFormDialog";
import type { ListFormPayload } from "@/components/lists/ListForm";
import { useCollapsedLists } from "@/hooks/useCollapsedLists";
import {
  useClearCompletedItems,
  useCreateList,
  useCreateListItem,
  useDeleteList,
  useDeleteListItem,
  useListsWithItems,
  useUpdateList,
  useUpdateListItem,
} from "@/hooks/useLists";
import type { ListItem, ListWithItems } from "@/types/database";

export const Route = createFileRoute("/_app/lists/")({
  component: ListsPage,
});

function ListsPage() {
  const listsQuery = useListsWithItems();

  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const createItem = useCreateListItem();
  const updateItem = useUpdateListItem();
  const deleteItem = useDeleteListItem();
  const clearCompleted = useClearCompletedItems();
  const collapsed = useCollapsedLists();

  const lists = useMemo<ListWithItems[]>(() => listsQuery.data ?? [], [listsQuery.data]);
  const allListIds = useMemo(() => lists.map((l) => l.id), [lists]);
  const allCollapsed = collapsed.isAllCollapsed(allListIds);

  // List form dialog state.
  const [formOpen, setFormOpen] = useState(false);
  const [editingList, setEditingList] = useState<ListWithItems | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete-list confirmation state. Items inside the list cascade-delete via
  // the FK, so this is the only confirmation we need.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [listToDelete, setListToDelete] = useState<ListWithItems | null>(null);

  const openAdd = () => {
    setEditingList(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (list: ListWithItems) => {
    setEditingList(list);
    setFormError(null);
    setFormOpen(true);
  };

  const handleFormSubmit = async (payload: ListFormPayload) => {
    setFormError(null);
    try {
      if (editingList) {
        await updateList.mutateAsync({ id: editingList.id, payload });
      } else {
        await createList.mutateAsync(payload);
      }
      setFormOpen(false);
      setEditingList(null);
    } catch (err) {
      const fallback = editingList ? "Greška pri izmeni liste" : "Greška pri kreiranju liste";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingList(null);
      setFormError(null);
    }
  };

  const confirmDelete = (list: ListWithItems) => {
    setListToDelete(list);
    setDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!listToDelete) return;
    try {
      await deleteList.mutateAsync(listToDelete.id);
      setDeleteOpen(false);
      setListToDelete(null);
    } catch {
      // Toast surfaced by hook's onError.
    }
  };

  const handleAddItem = (listId: string, name: string) => {
    createItem.mutate({ list_id: listId, name });
  };

  const handleToggleItem = (item: ListItem) => {
    updateItem.mutate({ id: item.id, payload: { is_completed: !item.is_completed } });
  };

  const handleUpdateItem = (
    item: ListItem,
    payload: { name: string; description: string | null },
  ) => {
    updateItem.mutate({ id: item.id, payload });
  };

  const handleDeleteItem = (item: ListItem) => {
    deleteItem.mutate(item.id);
  };

  const handleClearCompleted = (listId: string) => {
    clearCompleted.mutate(listId);
  };

  const isLoading = listsQuery.isLoading;
  const showEmpty = !isLoading && lists.length === 0;

  const deleteConfirmMessage = listToDelete
    ? `Obrisati listu "${listToDelete.name}" i sve njene stavke?`
    : "";

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Liste</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Šoping, obaveze i sve ostalo. Porodične liste vide svi članovi u realnom vremenu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          {/* Bulk-collapse toggle. We only show it once there are at
              least two lists — with one list there's nothing to bulk-
              operate on, and the chevron on that single card already
              covers it. The label flips between "Razvij" and "Skupi"
              based on whether everything is currently collapsed. */}
          {lists.length > 1 ? (
            <Button
              variant="outline"
              onClick={() => {
                if (allCollapsed) collapsed.expandAll();
                else collapsed.collapseAll(allListIds);
              }}
              aria-pressed={allCollapsed}
            >
              {allCollapsed ? (
                <>
                  <ChevronDoubleDownIcon className="mr-2 h-5 w-5" />
                  Razvij sve
                </>
              ) : (
                <>
                  <ChevronDoubleUpIcon className="mr-2 h-5 w-5" />
                  Skupi sve
                </>
              )}
            </Button>
          ) : null}
          <Button onClick={openAdd}>
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj listu
          </Button>
        </div>
      </div>

      {isLoading ? <div className="mt-6 text-gray-500">Učitavanje…</div> : null}

      {showEmpty ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-700 dark:text-gray-300">Još nemate nijednu listu.</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Napravite prvu listu — npr. „Šoping" deljen sa porodicom ili „Lične obaveze".
          </p>
          <Button onClick={openAdd} className="mt-4">
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj prvu listu
          </Button>
        </div>
      ) : null}

      {!isLoading && lists.length > 0 ? (
        // CSS-columns masonry. A flex/grid row would stretch every card to
        // the tallest sibling, which looks bad when one list is much longer
        // than the others. Column flow lets each card take only its own
        // intrinsic height; `break-inside-avoid` keeps a single card from
        // being split across columns mid-render.
        //
        // Mobile (< md) stays single-column; from md+ we flow two columns.
        // Reading order goes top-to-bottom then jumps to the next column,
        // matching the same "newest at the bottom" mental model the grid
        // had (sort_order is unchanged).
        <div className="mt-6 md:columns-2 md:gap-4">
          {lists.map((list) => (
            <div key={list.id} className="mb-4 break-inside-avoid">
              <ListCard
                list={list}
                onEdit={openEdit}
                onDelete={confirmDelete}
                onAddItem={handleAddItem}
                onToggleItem={handleToggleItem}
                onUpdateItem={handleUpdateItem}
                onDeleteItem={handleDeleteItem}
                onClearCompleted={handleClearCompleted}
                collapsed={collapsed.isCollapsed(list.id)}
                onToggleCollapsed={collapsed.toggle}
              />
            </div>
          ))}
        </div>
      ) : null}

      <ListFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        list={editingList}
        error={formError}
        saving={createList.isPending || updateList.isPending}
        onSubmit={(payload) => {
          void handleFormSubmit(payload);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setListToDelete(null);
        }}
        title="Obriši listu"
        message={deleteConfirmMessage}
        loading={deleteList.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />
    </div>
  );
}
