import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  InformationCircleIcon,
  PencilIcon,
  SparklesIcon,
  TableCellsIcon,
  TrashIcon,
  UserGroupIcon,
  UserIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { MarkdownText } from "@/components/common/MarkdownText";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListBody } from "@/components/lists/ListBody";
import { ListFormDialog } from "@/components/lists/ListFormDialog";
import { ListInfoPanel } from "@/components/lists/ListInfoPanel";
import { useIsWide } from "@/hooks/useIsWide";
import { useSmartSort } from "@/hooks/useSmartSort";
import { writeLastOpenedListId } from "@/lib/lastOpenedList";
import type { ListFormMode, ListFormPayload } from "@/components/lists/ListForm";
import {
  useClearCompletedItems,
  useCopyListItems,
  useCreateList,
  useCreateListItem,
  useDeleteList,
  useDeleteListItem,
  useListsWithItems,
  useUpdateList,
  useUpdateListItem,
} from "@/hooks/useLists";
import { cn } from "@/lib/cn";
import { exportListAsCsv, exportListAsMarkdown } from "@/lib/listExport";
import type { List, ListItem, ListWithItems } from "@/types/database";

export const Route = createFileRoute("/_app/lists/$listId")({
  component: ListDetailPage,
});

/**
 * View of a single list.
 *
 * Renders in two contexts off the same component:
 *   • Desktop (>= lg): inside the right panel of the master-detail shell. The
 *     sidebar is already on screen, so there is no back button — the panel just
 *     shows the open list.
 *   • Mobile (< lg): as a full page reached from the master list, with a
 *     back-arrow to `/lists`.
 *
 * Reuses `ListBody` for the items + add-input + per-item delete confirm so any
 * change to that interaction lands everywhere. The list is read from the same
 * `useListsWithItems()` query the master uses — the cached array gives instant
 * render on selection, and realtime keeps it fresh.
 */
function ListDetailPage() {
  const { listId } = useParams({ from: "/_app/lists/$listId" });
  const navigate = useNavigate();
  const isWide = useIsWide();
  const listsQuery = useListsWithItems();
  const list = (listsQuery.data ?? []).find((l) => l.id === listId) ?? null;

  // Remember the open list so a later bare `/lists` visit (on desktop) re-opens
  // it instead of always falling back to the first. Writing on mobile too is
  // harmless — only the desktop index resolver reads it back.
  const foundId = list?.id;
  useEffect(() => {
    if (foundId) writeLastOpenedListId(foundId);
  }, [foundId]);

  const goBack = () => {
    void navigate({ to: "/lists" });
  };

  // Loading / not-found render minimal chrome. The back button only exists on
  // mobile; on desktop the sidebar is the way back. Once `list` is non-null we
  // drop into the inner component, which can safely call hooks (`useSmartSort`)
  // that need a real list — keeping hook order stable across states.
  if (listsQuery.isLoading) {
    return (
      <div className="animate-fade-in">
        {!isWide ? <PageHeader onBack={goBack} /> : null}
        <p className="mt-6 text-gray-500 dark:text-gray-400">Učitavanje…</p>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="animate-fade-in">
        {!isWide ? <PageHeader onBack={goBack} /> : null}
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-700 dark:text-gray-300">Lista nije pronađena.</p>
          <Button variant="outline" onClick={goBack} className="mt-4">
            Nazad na liste
          </Button>
        </div>
      </div>
    );
  }

  return <ListDetailLoaded list={list} onBack={goBack} showBack={!isWide} />;
}

function ListDetailLoaded({
  list,
  onBack,
  showBack,
}: {
  list: ListWithItems;
  onBack: () => void;
  showBack: boolean;
}) {
  const navigate = useNavigate();

  const updateList = useUpdateList();
  const createList = useCreateList();
  const copyListItems = useCopyListItems();
  const deleteList = useDeleteList();
  const createItem = useCreateListItem();
  const updateItem = useUpdateListItem();
  const deleteItem = useDeleteListItem();
  const clearCompleted = useClearCompletedItems();
  const smartSort = useSmartSort(list);

  // One dialog serves edit + duplicate. `formMode` is the source of truth for
  // create-vs-update at submit (a duplicate is pre-filled yet still creates a
  // new row). `formInitial` carries the pre-filled values and stays referentially
  // stable for the dialog's lifetime so ListForm's reset-on-`list`-change effect
  // doesn't wipe the user's edits on realtime updates.
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<ListFormMode>("edit");
  const [formInitial, setFormInitial] = useState<List | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const openEdit = () => {
    setFormMode("edit");
    setFormInitial(list);
    setFormError(null);
    setFormOpen(true);
  };

  // Duplicate copies the list's *settings* into a fresh list; the form's
  // "Kopiraj i stavke" checkbox (default on) additionally clones the items
  // as not-completed. The "(kopija)" suffix stops a blind Save from
  // producing two identically-named lists.
  const openDuplicate = () => {
    setFormMode("duplicate");
    setFormInitial({ ...list, name: `${list.name} (kopija)` });
    setFormError(null);
    setFormOpen(true);
  };

  const handleFormSubmit = async (payload: ListFormPayload) => {
    setFormError(null);
    try {
      if (formMode === "edit") {
        await updateList.mutateAsync({ id: list.id, payload });
      } else {
        const created = await createList.mutateAsync(payload);
        // "Dupliraj sa stavkama": clone this list's items into the new one.
        // The list itself already exists at this point, so a copy failure
        // only toasts (via the hook's onError) instead of holding the form
        // open — a retry would create a second duplicate list.
        if (formMode === "duplicate" && payload.copyItems) {
          await copyListItems
            .mutateAsync({ items: list.list_items, targetListId: created.id })
            .catch(() => undefined);
        }
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

  const handleDeleteConfirm = async () => {
    try {
      await deleteList.mutateAsync(list.id);
      setDeleteOpen(false);
      // Leave the now-broken URL. On desktop /lists re-resolves to the next
      // available list; on mobile it returns to the master list.
      void navigate({ to: "/lists" });
    } catch {
      // Toast surfaced by the hook's onError; stay on page so the user can retry.
    }
  };

  const handleAddItem = (id: string, name: string) => {
    createItem.mutate({ list_id: id, name });
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

  return (
    <div className="animate-fade-in">
      {showBack ? <PageHeader onBack={onBack} /> : null}

      <ListHeader
        list={list}
        onEdit={openEdit}
        onDuplicate={openDuplicate}
        onDelete={() => setDeleteOpen(true)}
        onClearCompleted={() => clearCompleted.mutate(list.id)}
        onShowInfo={() => setInfoOpen(true)}
        smartSort={smartSort}
      />

      {list.description && list.description.trim() ? (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <MarkdownText content={list.description} />
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <ListBody
          list={list}
          onAddItem={handleAddItem}
          onToggleItem={handleToggleItem}
          onUpdateItem={handleUpdateItem}
          onDeleteItem={handleDeleteItem}
          // Headers visible only while the user has explicitly turned
          // smart-sort ON. `smartSort.isShopping` (detection) gates the
          // *toggle button*; `smartSort.enabled` (persisted flag) gates the
          // actual grouping.
          showCategoryHeaders={smartSort.enabled}
        />
      </div>

      <ListFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        list={formInitial}
        mode={formMode}
        error={formError}
        saving={updateList.isPending || createList.isPending || copyListItems.isPending}
        onSubmit={(payload) => {
          void handleFormSubmit(payload);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Obriši listu"
        message={`Obrisati listu "${list.name}" i sve njene stavke?`}
        loading={deleteList.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />

      <ListInfoPanel open={infoOpen} onOpenChange={setInfoOpen} list={list} />
    </div>
  );
}

function PageHeader({ onBack }: { onBack: () => void }) {
  // Single button wrapping arrow + label so the whole row is a tap target.
  // The negative left margin keeps the icon visually flush with the page edge
  // while the button itself has padding for a comfortable hit area.
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-label="Nazad na liste"
    >
      <ArrowLeftIcon className="h-5 w-5" />
      <span>Liste</span>
    </button>
  );
}

function ListHeader({
  list,
  onEdit,
  onDuplicate,
  onDelete,
  onClearCompleted,
  onShowInfo,
  smartSort,
}: {
  list: ListWithItems;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClearCompleted: () => void;
  onShowInfo: () => void;
  smartSort: ReturnType<typeof useSmartSort>;
}) {
  const active = list.list_items.filter((i) => !i.is_completed).length;
  const completed = list.list_items.filter((i) => i.is_completed).length;

  const ScopeIcon = list.scope === "family" ? UserGroupIcon : UserIcon;
  const scopeLabel = list.scope === "family" ? "Porodica" : "Lično";

  return (
    <header className="mt-2 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold text-gray-900 dark:text-white">
          {list.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              list.scope === "family"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
            )}
          >
            <ScopeIcon className="h-3.5 w-3.5" />
            {scopeLabel}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {active} {active === 1 ? "aktivna" : "aktivnih"}
            {completed > 0 ? ` • ${completed} završeno` : ""}
          </span>
        </div>
      </div>

      {/* Top-level smart-sort toggle. Only rendered when the categoriser
          flagged the list as a shopping list — non-shopping lists never see
          the affordance. Active state colours the icon and tints the
          background so the on/off state is obvious at a glance. */}
      {smartSort.isShopping ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            smartSort.enabled ? "Isključi pametno sortiranje" : "Uključi pametno sortiranje"
          }
          aria-pressed={smartSort.enabled}
          disabled={smartSort.isPending}
          onClick={() => {
            void smartSort.toggle();
          }}
          className={cn(
            smartSort.enabled &&
              "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60",
          )}
        >
          <SparklesIcon className="h-5 w-5" />
        </Button>
      ) : null}

      <Button variant="ghost" size="icon-sm" aria-label="Detalji liste" onClick={onShowInfo}>
        <InformationCircleIcon className="h-5 w-5" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Akcije liste">
            <EllipsisVerticalIcon className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon className="h-4 w-4" />
            Izmeni listu
          </DropdownMenuItem>
          {/* Duplicate copies the list's settings (name, scope, description,
              retention) into a fresh list; the form offers "Kopiraj i stavke"
              to also clone the items as not-completed. Grouped with "Izmeni"
              since both are "set up a list" actions. */}
          <DropdownMenuItem onSelect={onDuplicate}>
            <DocumentDuplicateIcon className="h-4 w-4" />
            Dupliraj listu
          </DropdownMenuItem>
          {/* Export entries — disabled on empty lists (the file would be empty). */}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => exportListAsMarkdown(list)}
            disabled={list.list_items.length === 0}
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Eksportuj (Markdown)
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => exportListAsCsv(list)}
            disabled={list.list_items.length === 0}
          >
            <TableCellsIcon className="h-4 w-4" />
            Eksportuj (CSV)
          </DropdownMenuItem>
          {completed > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClearCompleted}>
                <TrashIcon className="h-4 w-4" />
                Obriši završene ({completed})
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <TrashIcon className="h-4 w-4" />
            Obriši listu
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
