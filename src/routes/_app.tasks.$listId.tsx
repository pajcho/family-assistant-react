import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  InformationCircleIcon,
  PencilIcon,
  TableCellsIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DetailActionList, DetailActionRow } from "@/components/common/DetailSheet";
import { IconButton } from "@/components/common/IconButton";
import { MarkdownText } from "@/components/common/MarkdownText";
import { SheetStackHeader } from "@/components/common/SheetStack";
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
import { ListFormDialog } from "@/components/tasks/ListFormDialog";
import { ListInfoPanel } from "@/components/tasks/ListInfoPanel";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import { TaskGroupingSelector } from "@/components/tasks/TaskGroupingSelector";
import { TaskListBody, type TaskGrouping } from "@/components/tasks/TaskListBody";
import { TaskScreenHeader, TaskScreenShell } from "@/components/tasks/TaskScreenShell";
import { useIsWide } from "@/hooks/useIsWide";
import { useSmartSort } from "@/hooks/useSmartSort";
import { useToday } from "@/hooks/useToday";
import { writeLastOpenedListId } from "@/lib/lastOpenedList";
import type { ListFormMode, ListFormPayload } from "@/components/tasks/ListForm";
import {
  useClearCompletedTasks,
  useCopyTasks,
  useCreateList,
  useDeleteList,
  useListsWithTasks,
  useUpdateList,
} from "@/hooks/useTasks";
import { exportListAsCsv, exportListAsMarkdown } from "@/lib/listExport";
import { isTaskOverdue } from "@/utils/task";
import type { List, ListWithTasks } from "@/types/database";

export const Route = createFileRoute("/_app/tasks/$listId")({
  component: ListDetailPage,
});

/**
 * One list.
 *
 * Renders in two contexts off the same component:
 *   • Desktop (>= lg): inside the right panel of the master-detail shell. The
 *     sidebar is already on screen, so there is no back button and the composer
 *     sits inline after the last row, where the pointer already is.
 *   • Mobile (< lg): as a full page reached from the overview, with a back arrow
 *     to `/tasks` and the composer pinned above the bottom bar.
 *
 * The list is read from the same `useListsWithTasks()` query the sidebar uses -
 * the cached array gives an instant render on selection, and realtime keeps it
 * fresh.
 */
function ListDetailPage() {
  const { listId } = useParams({ from: "/_app/tasks/$listId" });
  const navigate = useNavigate();
  const isWide = useIsWide();
  const listsQuery = useListsWithTasks();
  const list = (listsQuery.data ?? []).find((l) => l.id === listId) ?? null;

  // Remember the open list so a later bare `/tasks` visit (on desktop) re-opens
  // it instead of always falling back to the first. Writing on mobile too is
  // harmless - only the desktop index resolver reads it back.
  const foundId = list?.id;
  useEffect(() => {
    if (foundId) writeLastOpenedListId(foundId);
  }, [foundId]);

  const goBack = () => {
    void navigate({ to: "/tasks" });
  };

  // Loading / not-found render minimal chrome. The back button only exists on
  // mobile; on desktop the sidebar is the way back. Once `list` is non-null we
  // drop into the inner component, which can safely call hooks (`useSmartSort`)
  // that need a real list - keeping hook order stable across states.
  if (listsQuery.isLoading) {
    return (
      <TaskScreenShell isWide={isWide} header={<BackRow onBack={goBack} />}>
        <p className="text-muted-foreground">Učitavanje…</p>
      </TaskScreenShell>
    );
  }

  if (!list) {
    return (
      <TaskScreenShell isWide={isWide} header={<BackRow onBack={goBack} />}>
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-foreground">Lista nije pronađena.</p>
          <Button variant="outline" onClick={goBack} className="mt-4">
            Nazad na zadatke
          </Button>
        </div>
      </TaskScreenShell>
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
  const today = useToday().str;

  const updateList = useUpdateList();
  const createList = useCreateList();
  const copyTasks = useCopyTasks();
  const deleteList = useDeleteList();
  const clearCompleted = useClearCompletedTasks();
  const smartSort = useSmartSort(list);

  // "Po rafovima" IS the persisted `smart_sort_enabled` flag, so it is derived
  // rather than held: picking it turns the flag on, picking anything else turns it
  // off (non-destructively - the manual order underneath is never rewritten).
  const [localGrouping, setLocalGrouping] = useState<Exclude<TaskGrouping, "aisle">>("manual");
  const grouping: TaskGrouping = smartSort.enabled ? "aisle" : localGrouping;
  const setGrouping = (next: TaskGrouping) => {
    if (next === "aisle") {
      if (!smartSort.enabled) void smartSort.toggle();
      return;
    }
    if (smartSort.enabled) void smartSort.toggle();
    setLocalGrouping(next);
  };

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
  // copy-items checkbox (default on) additionally clones the tasks as
  // not-completed. The "(kopija)" suffix stops a blind Save from producing two
  // identically-named lists.
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
        // "Dupliraj sa stavkama": clone this list's tasks into the new one. The
        // list itself already exists at this point, so a copy failure only toasts
        // (via the hook's onError) instead of holding the form open - a retry
        // would create a second duplicate list.
        if (formMode === "duplicate" && payload.copyItems) {
          await copyTasks
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
      // Leave the now-broken URL. On desktop /tasks re-resolves to the next
      // available list; on mobile it returns to the overview.
      void navigate({ to: "/tasks" });
    } catch {
      // Toast surfaced by the hook's onError; stay on page so the user can retry.
    }
  };

  return (
    <TaskScreenShell
      isWide={!showBack}
      header={
        <TaskScreenHeader
          title={list.name}
          subtitle={listSubtitle(list, today)}
          showBack={showBack}
          onBack={onBack}
          actions={
            <ListHeaderActions
              list={list}
              onEdit={openEdit}
              onDuplicate={openDuplicate}
              onDelete={() => setDeleteOpen(true)}
              onClearCompleted={() => clearCompleted.mutate(list.id)}
              onShowInfo={() => setInfoOpen(true)}
            />
          }
          toolbar={
            <div className="flex items-center gap-2">
              <TaskGroupingSelector
                value={grouping}
                onChange={setGrouping}
                allowAisle={smartSort.isShopping}
                disabled={smartSort.isPending}
              />
            </div>
          }
        />
      }
    >
      {list.description && list.description.trim() ? (
        <div className="mb-3 rounded-xl border border-border bg-card p-3 shadow-card">
          <MarkdownText content={list.description} />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <TaskListBody list={list} grouping={grouping} today={today} />
      </div>

      {/* The gesture hints that used to live here are gone: two permanent
          paragraphs explaining swipe and hover are instructions for something you
          learned in week one. */}
      <TaskComposer
        listId={list.id}
        variant={showBack ? "pinned" : "inline"}
        placeholder={`Dodaj u „${list.name}"…`}
      />

      <ListFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        list={formInitial}
        mode={formMode}
        error={formError}
        saving={updateList.isPending || createList.isPending || copyTasks.isPending}
        onSubmit={(payload) => {
          void handleFormSubmit(payload);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Obriši listu"
        message={`Obrisati listu „${list.name}" i sve njene zadatke?`}
        loading={deleteList.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />

      <ListInfoPanel open={infoOpen} onOpenChange={setInfoOpen} list={list} />
    </TaskScreenShell>
  );
}

/** "porodična · 4 aktivna · 2 sa datumom · 1 kasni" - the sub-line under the title. */
function listSubtitle(list: ListWithTasks, today: string): string {
  const active = list.tasks.filter((task) => !task.is_completed);
  const dated = active.filter((task) => task.due_date !== null).length;
  const late = active.filter((task) => isTaskOverdue(task, today)).length;
  return [
    list.scope === "family" ? "porodična" : "lična",
    `${active.length} ${active.length === 1 ? "aktivan" : "aktivnih"}`,
    dated > 0 ? `${dated} sa datumom` : null,
    late > 0 ? `${late} kasni` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function BackRow({ onBack }: { onBack: () => void }) {
  return <IconButton icon={ArrowLeftIcon} aria-label="Nazad na zadatke" onClick={onBack} />;
}

/**
 * The list's own actions - everything that acts on the CONTAINER rather than on a
 * task in it. An anchored dropdown on desktop, a bottom sheet of
 * `DetailActionRow`s on phones (the DetailSheet convention): an anchored menu in
 * the top-right corner is a stretch for the thumb and easy to mis-tap. One action
 * at a time - a row closes the sheet, then runs.
 */
function ListHeaderActions({
  list,
  onEdit,
  onDuplicate,
  onDelete,
  onClearCompleted,
  onShowInfo,
}: {
  list: ListWithTasks;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClearCompleted: () => void;
  onShowInfo: () => void;
}) {
  const completed = list.tasks.filter((task) => task.is_completed).length;
  const canExport = list.tasks.length > 0;

  const isDesktop = useIsDesktop();
  const [menuOpen, setMenuOpen] = useState(false);
  const runAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <>
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
                to also clone the tasks as not-completed. Grouped with "Izmeni"
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
    </>
  );
}
