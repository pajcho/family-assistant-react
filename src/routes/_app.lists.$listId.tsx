import * as React from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  EllipsisVerticalIcon,
  InformationCircleIcon,
  PencilIcon,
  SparklesIcon,
  TrashIcon,
  UserGroupIcon,
  UserIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
import { useSmartSort } from "@/hooks/useSmartSort";
import type { ListFormPayload } from "@/components/lists/ListForm";
import {
  useClearCompletedItems,
  useCreateListItem,
  useDeleteList,
  useDeleteListItem,
  useListsWithItems,
  useUpdateList,
  useUpdateListItem,
} from "@/hooks/useLists";
import { cn } from "@/lib/cn";
import type { ListItem, ListWithItems } from "@/types/database";

export const Route = createFileRoute("/_app/lists/$listId")({
  component: ListDetailPage,
});

/**
 * Full-page view of a single list.
 *
 * Reuses `ListBody` for the items + add-input + per-item delete confirm so
 * any change to that interaction lands in both places. The page adds:
 *   • a back-arrow that returns to /lists
 *   • a larger header with the list name + scope badge + item counts
 *   • the same "Izmeni / Obriši završene / Obriši listu" dropdown the card
 *     header has
 *
 * The list itself is read from the same `useListsWithItems()` query that
 * the /lists page uses — the cached array gives us instant render on
 * navigation from there, and realtime keeps everything fresh.
 */
function ListDetailPage() {
  const { listId } = useParams({ from: "/_app/lists/$listId" });
  const navigate = useNavigate();
  const listsQuery = useListsWithItems();
  const list = (listsQuery.data ?? []).find((l) => l.id === listId) ?? null;

  const goBack = () => {
    void navigate({ to: "/lists" });
  };

  // Loading / not-found states render minimal chrome. We keep the back
  // button visible in both so the user can always escape without using
  // the browser chrome. Once `list` is non-null we drop into the inner
  // component, which can safely call hooks (`useSmartSort`) that need
  // a real list object — keeps the hook order stable across loading
  // and loaded states.
  if (listsQuery.isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader onBack={goBack} />
        <p className="mt-6 text-gray-500 dark:text-gray-400">Učitavanje…</p>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="animate-fade-in">
        <PageHeader onBack={goBack} />
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-700 dark:text-gray-300">Lista nije pronađena.</p>
          <Button variant="outline" onClick={goBack} className="mt-4">
            Nazad na liste
          </Button>
        </div>
      </div>
    );
  }

  return <ListDetailLoaded list={list} onBack={goBack} />;
}

function ListDetailLoaded({ list, onBack }: { list: ListWithItems; onBack: () => void }) {
  const navigate = useNavigate();

  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const createItem = useCreateListItem();
  const updateItem = useUpdateListItem();
  const deleteItem = useDeleteListItem();
  const clearCompleted = useClearCompletedItems();
  const smartSort = useSmartSort(list);

  // Edit-list dialog state.
  const [formOpen, setFormOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Delete-list confirmation state.
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  // Info-panel state (creator + last-editor + per-item activity).
  const [infoOpen, setInfoOpen] = React.useState(false);

  const openEdit = () => {
    setFormError(null);
    setFormOpen(true);
  };

  const handleEditSubmit = async (payload: ListFormPayload) => {
    setFormError(null);
    try {
      await updateList.mutateAsync({ id: list.id, payload });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error && err.message ? err.message : "Greška pri izmeni liste");
    }
  };

  const handleEditOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) setFormError(null);
  };

  const handleDeleteConfirm = async () => {
    try {
      await deleteList.mutateAsync(list.id);
      setDeleteOpen(false);
      // After successful delete, leave the now-broken URL.
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

  const handleRenameItem = (item: ListItem, name: string) => {
    updateItem.mutate({ id: item.id, payload: { name } });
  };

  const handleDeleteItem = (item: ListItem) => {
    deleteItem.mutate(item.id);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader onBack={onBack} />

      <ListHeader
        list={list}
        onEdit={openEdit}
        onDelete={() => setDeleteOpen(true)}
        onClearCompleted={() => clearCompleted.mutate(list.id)}
        onShowInfo={() => setInfoOpen(true)}
        smartSort={smartSort}
      />

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <ListBody
          list={list}
          onAddItem={handleAddItem}
          onToggleItem={handleToggleItem}
          onRenameItem={handleRenameItem}
          onDeleteItem={handleDeleteItem}
          // Headers visible only while the user has explicitly turned
          // smart-sort ON. `smartSort.isShopping` (detection) is the
          // gate for the *toggle button*; `smartSort.enabled` (persisted
          // flag) is the gate for actually grouping items.
          showCategoryHeaders={smartSort.enabled}
        />
      </div>

      <ListFormDialog
        open={formOpen}
        onOpenChange={handleEditOpenChange}
        list={list}
        error={formError}
        saving={updateList.isPending}
        onSubmit={(payload) => {
          void handleEditSubmit(payload);
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
  return (
    <div className="-ml-2 flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Nazad na liste">
        <ArrowLeftIcon className="h-5 w-5" />
      </Button>
      <span className="text-sm text-gray-500 dark:text-gray-400">Liste</span>
    </div>
  );
}

function ListHeader({
  list,
  onEdit,
  onDelete,
  onClearCompleted,
  onShowInfo,
  smartSort,
}: {
  list: ListWithItems;
  onEdit: () => void;
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
          flagged the list as a shopping list — non-shopping lists never
          see the affordance. Active state colours the icon and tints the
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
