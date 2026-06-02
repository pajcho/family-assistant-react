import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ListCard } from "@/components/lists/ListCard";
import { ListFormDialog } from "@/components/lists/ListFormDialog";
import type { ListFormMode, ListFormPayload } from "@/components/lists/ListForm";
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
import type { List, ListItem, ListScope, ListWithItems } from "@/types/database";

export const Route = createFileRoute("/_app/lists/")({
  component: ListsPage,
});

/** Quick scope filter shown above the grid. "all" disables the filter. */
type ScopeFilter = "all" | ListScope;

const SCOPE_FILTERS: Array<{ value: ScopeFilter; label: string }> = [
  { value: "all", label: "Sve" },
  { value: "family", label: "Porodične" },
  { value: "personal", label: "Lične" },
];

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

  // Quick filters above the grid.
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");

  // The shared query is ordered by `updated_at` (which the dashboard wants —
  // "I just used this list, keep it on top"). On the overview the user asked
  // for creation order instead, newest first, so we re-sort client-side
  // rather than forking the fetch. `created_at` is an ISO string, so a
  // descending string compare is chronological.
  const sortedLists = useMemo(
    () => [...lists].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [lists],
  );

  // Scope chip + live search, applied on top of the sorted list. Search is
  // a case-insensitive substring match over the list name and its optional
  // description; lists are already in memory so we filter on every keystroke
  // without a round-trip or debounce.
  const filteredLists = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sortedLists.filter((list) => {
      if (scopeFilter !== "all" && list.scope !== scopeFilter) return false;
      if (query) {
        const haystack = `${list.name} ${list.description ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [sortedLists, scopeFilter, search]);

  // Bulk-collapse and the chevron states operate on what's actually on
  // screen, so narrowing the filter narrows what "Skupi sve" affects.
  const visibleListIds = useMemo(() => filteredLists.map((l) => l.id), [filteredLists]);
  const allCollapsed = collapsed.isAllCollapsed(visibleListIds);

  // List form dialog state. `formInitial` carries the pre-filled values
  // (edit target, or a duplicate's source) and stays referentially stable
  // for the dialog's lifetime so ListForm's reset-on-`list`-change effect
  // doesn't wipe the user's edits on every re-render. `formMode` is the
  // single source of truth for create-vs-update at submit time — we can't
  // infer it from `formInitial` because a duplicate is pre-filled yet still
  // creates a new row.
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<ListFormMode>("create");
  const [formInitial, setFormInitial] = useState<List | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete-list confirmation state. Items inside the list cascade-delete via
  // the FK, so this is the only confirmation we need.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [listToDelete, setListToDelete] = useState<ListWithItems | null>(null);

  const openAdd = () => {
    setFormMode("create");
    setFormInitial(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (list: ListWithItems) => {
    setFormMode("edit");
    setFormInitial(list);
    setFormError(null);
    setFormOpen(true);
  };

  // Duplicate pre-fills the form from an existing list but in "create" mode,
  // so the submit handler inserts a new (empty) list. We don't clone items —
  // only the list's own settings travel over. The name gets a "(kopija)"
  // suffix so a blind Save doesn't produce two identically-named lists.
  const openDuplicate = (list: ListWithItems) => {
    setFormMode("duplicate");
    setFormInitial({ ...list, name: `${list.name} (kopija)` });
    setFormError(null);
    setFormOpen(true);
  };

  const handleFormSubmit = async (payload: ListFormPayload) => {
    setFormError(null);
    try {
      if (formMode === "edit" && formInitial) {
        await updateList.mutateAsync({ id: formInitial.id, payload });
      } else {
        await createList.mutateAsync(payload);
      }
      setFormOpen(false);
      setFormInitial(null);
    } catch (err) {
      const fallback =
        formMode === "edit" ? "Greška pri izmeni liste" : "Greška pri kreiranju liste";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setFormInitial(null);
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

  const clearFilters = () => {
    setScopeFilter("all");
    setSearch("");
  };

  const isLoading = listsQuery.isLoading;
  // Three distinct end states: still loading, genuinely no lists at all, or
  // lists exist but the active filter/search hides every one of them.
  const showEmpty = !isLoading && lists.length === 0;
  const showNoMatches = !isLoading && lists.length > 0 && filteredLists.length === 0;
  const showFilters = !isLoading && lists.length > 1;

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
          {/* Bulk-collapse toggle. We only show it once at least two lists
              are visible — with one there's nothing to bulk-operate on, and
              the chevron on that single card already covers it. The label
              flips between "Razvij" and "Skupi" based on whether everything
              currently visible is collapsed. */}
          {filteredLists.length > 1 ? (
            <Button
              variant="outline"
              onClick={() => {
                if (allCollapsed) collapsed.expandAll();
                else collapsed.collapseAll(visibleListIds);
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

      {/* Quick filters: scope chips + live search. Shown once there's more
          than one list, since filtering a single card is pointless. The bar
          stays put even when the search hides everything, so the user can
          adjust or clear it. */}
      {showFilters ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {SCOPE_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                variant={scopeFilter === filter.value ? "default" : "outline"}
                size="sm"
                onClick={() => setScopeFilter(filter.value)}
                aria-pressed={scopeFilter === filter.value}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pretraži liste…"
              aria-label="Pretraži liste"
              className="px-9"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Obriši pretragu"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

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

      {showNoMatches ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-700 dark:text-gray-300">Nijedna lista ne odgovara filteru.</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Probajte drugačiju pretragu ili promenite filter pristupa.
          </p>
          <Button variant="outline" onClick={clearFilters} className="mt-4">
            Poništi filtere
          </Button>
        </div>
      ) : null}

      {!isLoading && filteredLists.length > 0 ? (
        // CSS-columns masonry. A flex/grid row would stretch every card to
        // the tallest sibling, which looks bad when one list is much longer
        // than the others. Column flow lets each card take only its own
        // intrinsic height; `break-inside-avoid` keeps a single card from
        // being split across columns mid-render.
        //
        // Mobile (< md) stays single-column; from md+ we flow two columns.
        <div className="mt-6 md:columns-2 md:gap-4">
          {filteredLists.map((list) => (
            <div key={list.id} className="mb-4 break-inside-avoid">
              <ListCard
                list={list}
                onEdit={openEdit}
                onDuplicate={openDuplicate}
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
        list={formInitial}
        mode={formMode}
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
