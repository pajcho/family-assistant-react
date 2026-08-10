import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DetailActionList, DetailActionRow } from "@/components/common/DetailSheet";
import { IconButton } from "@/components/common/IconButton";
import { MarkdownText } from "@/components/common/MarkdownText";
import { Pill } from "@/components/common/Pill";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { AppScreen } from "@/components/layout/AppScreen";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { ListBody } from "@/components/lists/ListBody";
import { ListFormDialog } from "@/components/lists/ListFormDialog";
import { ListInfoPanel } from "@/components/lists/ListInfoPanel";
import { useIsWide } from "@/hooks/useIsWide";
import { useSmartSort } from "@/hooks/useSmartSort";
import { writeLastOpenedListId } from "@/lib/lastOpenedList";
import type { ListFormMode, ListFormPayload } from "@/components/lists/ListForm";
import {
  useClearCompletedTasks,
  useCopyTasks,
  useCreateList,
  useCreateTask,
  useDeleteList,
  useDeleteTask,
  useListsWithTasks,
  useUpdateList,
  useUpdateTask,
} from "@/hooks/useTasks";
import { exportListAsCsv, exportListAsMarkdown } from "@/lib/listExport";
import type { List, Task, ListWithTasks } from "@/types/database";

export const Route = createFileRoute("/_app/lists/$listId")({
  component: ListDetailPage,
});

/**
 * View of a single list.
 *
 * Renders in two contexts off the same component:
 *   • Desktop (>= lg): inside the right panel of the master-detail shell. The
 *     sidebar is already on screen, so there is no back button - the panel just
 *     shows the open list.
 *   • Mobile (< lg): as a full page reached from the master list, with a
 *     back-arrow to `/lists`.
 *
 * Reuses `ListBody` for the items + add-input + per-item delete confirm so any
 * change to that interaction lands everywhere. The list is read from the same
 * `useListsWithTasks()` query the master uses - the cached array gives instant
 * render on selection, and realtime keeps it fresh.
 */
function ListDetailPage() {
  const { listId } = useParams({ from: "/_app/lists/$listId" });
  const navigate = useNavigate();
  const isWide = useIsWide();
  const listsQuery = useListsWithTasks();
  const list = (listsQuery.data ?? []).find((l) => l.id === listId) ?? null;

  // Remember the open list so a later bare `/lists` visit (on desktop) re-opens
  // it instead of always falling back to the first. Writing on mobile too is
  // harmless - only the desktop index resolver reads it back.
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
  // that need a real list - keeping hook order stable across states.
  if (listsQuery.isLoading) {
    return (
      <DetailShell isWide={isWide} header={<BackRow onBack={goBack} />}>
        <p className="text-muted-foreground">Učitavanje…</p>
      </DetailShell>
    );
  }

  if (!list) {
    return (
      <DetailShell isWide={isWide} header={<BackRow onBack={goBack} />}>
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-foreground">Lista nije pronađena.</p>
          <Button variant="outline" onClick={goBack} className="mt-4">
            Nazad na liste
          </Button>
        </div>
      </DetailShell>
    );
  }

  return <ListDetailLoaded list={list} onBack={goBack} showBack={!isWide} />;
}

function ListDetailLoaded({
  list,
  onBack,
  showBack,
}: {
  list: ListWithTasks;
  onBack: () => void;
  showBack: boolean;
}) {
  const navigate = useNavigate();

  const updateList = useUpdateList();
  const createList = useCreateList();
  const copyListItems = useCopyTasks();
  const deleteList = useDeleteList();
  const createItem = useCreateTask();
  const updateItem = useUpdateTask();
  const deleteItem = useDeleteTask();
  const clearCompleted = useClearCompletedTasks();
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
  // The copy-items checkbox (default on) additionally clones the items
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
        // open - a retry would create a second duplicate list.
        if (formMode === "duplicate" && payload.copyItems) {
          await copyListItems
            .mutateAsync({ tasks: list.tasks, targetListId: created.id })
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

  const handleToggleItem = (item: Task) => {
    updateItem.mutate({ id: item.id, payload: { is_completed: !item.is_completed } });
  };

  const handleUpdateItem = (item: Task, payload: { name: string; description: string | null }) => {
    updateItem.mutate({ id: item.id, payload });
  };

  const handleDeleteItem = (item: Task) => {
    deleteItem.mutate(item.id);
  };

  return (
    <DetailShell
      isWide={!showBack}
      header={
        <ListHeader
          list={list}
          showBack={showBack}
          onBack={onBack}
          onEdit={openEdit}
          onDuplicate={openDuplicate}
          onDelete={() => setDeleteOpen(true)}
          onClearCompleted={() => clearCompleted.mutate(list.id)}
          onShowInfo={() => setInfoOpen(true)}
          smartSort={smartSort}
        />
      }
    >
      {list.description && list.description.trim() ? (
        <div className="mb-3 rounded-xl border border-border bg-card p-3 shadow-card">
          <MarkdownText content={list.description} />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
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

      {/* Two hints, one per input method - the gestures below only exist on a
          touch screen, and a mouse gets the row's own hover controls instead.
          `pointer:` (not a width breakpoint) because that is what decides
          which affordances the rows actually render. */}
      <p className="mt-4 hidden px-5 text-center text-[11.5px] font-normal text-muted-foreground pointer-coarse:block">
        Prevuci desno = završeno · prevuci levo = obriši · drži i prevuci = redosled.
      </p>
      <p className="mt-4 hidden px-5 text-center text-[11.5px] font-normal text-muted-foreground pointer-fine:block">
        Klikni kvadratić = završeno · pređi mišem preko stavke za izmenu, brisanje i redosled.
      </p>

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
    </DetailShell>
  );
}

/**
 * Same page in two frames: below lg the list detail IS the screen, so it gets
 * a fixed header + its own scrolling body; at lg it renders inside the
 * master-detail panel, which already scrolls, so it stays plain flow.
 */
function DetailShell({
  isWide,
  header,
  children,
}: {
  isWide: boolean;
  header: ReactNode;
  children: ReactNode;
}) {
  if (isWide) {
    return (
      <div className="animate-fade-in">
        <div className="mb-3">{header}</div>
        {children}
      </div>
    );
  }
  return <AppScreen header={header}>{children}</AppScreen>;
}

function BackRow({ onBack }: { onBack: () => void }) {
  return <IconButton icon={ArrowLeftIcon} aria-label="Nazad na liste" onClick={onBack} />;
}

function ListHeader({
  list,
  showBack,
  onBack,
  onEdit,
  onDuplicate,
  onDelete,
  onClearCompleted,
  onShowInfo,
  smartSort,
}: {
  list: ListWithTasks;
  /** Mobile only - the desktop sidebar is the way back. */
  showBack: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClearCompleted: () => void;
  onShowInfo: () => void;
  smartSort: ReturnType<typeof useSmartSort>;
}) {
  const active = list.tasks.filter((i) => !i.is_completed).length;
  const completed = list.tasks.filter((i) => i.is_completed).length;
  const scopeLabel = list.scope === "family" ? "Porodica" : "Lično";
  const canExport = list.tasks.length > 0;

  // The actions menu: an anchored dropdown on desktop, a bottom sheet of
  // DetailActionRow rows on phones (the DetailSheet convention) - an anchored
  // menu at the top-right corner is a stretch for the thumb and easy to
  // mis-tap. One action at a time: a row closes the sheet, then runs.
  const isDesktop = useIsDesktop();
  const [menuOpen, setMenuOpen] = useState(false);
  const runAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="flex items-center gap-2">
      {showBack ? <BackRow onBack={onBack} /> : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl leading-tight font-bold tracking-tight">{list.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Pill tone={list.scope === "family" ? "accent" : "muted"}>{scopeLabel}</Pill>
          <span className="text-[12.5px] font-normal text-muted-foreground">
            {active} {active === 1 ? "aktivna" : "aktivnih"}
            {completed > 0 ? ` · ${completed} završeno` : ""}
          </span>
        </div>
      </div>

      {/* Top-level smart-sort toggle. Only rendered when the categoriser
          flagged the list as a shopping list - non-shopping lists never see
          the affordance. `active` tints the glyph with the accent so the
          on/off state is obvious at a glance. */}
      {smartSort.isShopping ? (
        <IconButton
          icon={SparklesIcon}
          aria-label={
            smartSort.enabled ? "Isključi pametno sortiranje" : "Uključi pametno sortiranje"
          }
          aria-pressed={smartSort.enabled}
          active={smartSort.enabled}
          disabled={smartSort.isPending}
          onClick={() => {
            void smartSort.toggle();
          }}
        />
      ) : null}

      <IconButton icon={InformationCircleIcon} aria-label="Detalji liste" onClick={onShowInfo} />

      {isDesktop ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={EllipsisVerticalIcon} aria-label="Akcije liste" />
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
            {/* Export entries - disabled on empty lists (the file would be empty). */}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => exportListAsMarkdown(list)} disabled={!canExport}>
              <ArrowDownTrayIcon className="h-4 w-4" />
              Eksportuj (Markdown)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportListAsCsv(list)} disabled={!canExport}>
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
      ) : (
        <>
          <IconButton
            icon={EllipsisVerticalIcon}
            aria-label="Akcije liste"
            onClick={() => setMenuOpen(true)}
          />
          <ResponsiveDialog open={menuOpen} onOpenChange={setMenuOpen}>
            <ResponsiveDialogContent>
              <SheetStackHeader title="Akcije liste" />
              <DetailActionList>
                <DetailActionRow
                  icon={PencilIcon}
                  label="Izmeni listu"
                  onClick={() => runAction(onEdit)}
                />
                <DetailActionRow
                  icon={DocumentDuplicateIcon}
                  label="Dupliraj listu"
                  onClick={() => runAction(onDuplicate)}
                />
                <DetailActionRow
                  icon={ArrowDownTrayIcon}
                  label="Eksportuj (Markdown)"
                  disabled={!canExport}
                  onClick={() => runAction(() => exportListAsMarkdown(list))}
                />
                <DetailActionRow
                  icon={TableCellsIcon}
                  label="Eksportuj (CSV)"
                  disabled={!canExport}
                  onClick={() => runAction(() => exportListAsCsv(list))}
                />
                {completed > 0 ? (
                  <DetailActionRow
                    icon={TrashIcon}
                    label={`Obriši završene (${completed})`}
                    onClick={() => runAction(onClearCompleted)}
                  />
                ) : null}
                <DetailActionRow
                  icon={TrashIcon}
                  label="Obriši listu"
                  tone="destructive"
                  onClick={() => runAction(onDelete)}
                />
              </DetailActionList>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        </>
      )}
    </header>
  );
}
