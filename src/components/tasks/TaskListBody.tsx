import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { format, parseISO } from "date-fns";
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

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionHeading } from "@/components/common/SectionHeading";
import { TaskEditDialog, type TaskEditPayload } from "@/components/tasks/TaskEditDialog";
import {
  TaskListRow,
  type DragHandleBindings,
  type TaskListRowProps,
} from "@/components/tasks/TaskListRow";
import { SwipeableTaskRow } from "@/components/tasks/SwipeableTaskRow";
import { assigneeProgress, nextTaskInstance, taskTickSlot } from "@/components/tasks/taskItemModel";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile } from "@/hooks/useProfile";
import { useDeleteTask, useReorderTasks, useToggleTask, useUpdateTask } from "@/hooks/useTasks";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { CATEGORY_LABEL, groupByCategory } from "@/hooks/useSmartSort";
import { srLocale } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";
import { shiftIsoByDays } from "@/utils/pickerGrid";
import { isFutureOccurrence, isTaskDoneOn, taskRecurrenceLabel } from "@/utils/task";
import type { Task, ListWithTasks } from "@/types/database";

/**
 * How the rows of one list are arranged. `aisle` is the persisted
 * `lists.smart_sort_enabled` flag; the other three are a view choice the
 * grouping selector holds. Only `manual` offers drag-to-reorder - in every other
 * mode the visual order is derived, so a drop would be discarded by the next
 * render.
 */
export type TaskGrouping = "manual" | "date" | "aisle" | "person";

/** One row's resolved state: which instance it stands for and whether it is done. */
type ResolvedTask = {
  task: Task;
  /** SERIES date of the instance this row acts on. Null for an undated task. */
  occurrenceDate: string | null;
  /** Where that instance sits - a moved occurrence differs from its series date. */
  effectiveDate: string | null;
  done: boolean;
  /** Whether the TASK is finished - everybody's answer, for strike and grouping. */
  rowDone: boolean;
  assigneeIds: string[];
  /** Whose copy of the occurrence this row's checkbox owns. */
  personId: string | null;
  /** False for somebody the task was not given to - see `taskTickSlot`. */
  canTick: boolean;
  /** "1/2" for a `per_assignee` chore this viewer is not on; null otherwise. */
  progress: { done: number; total: number } | null;
};

export type TaskListBodyProps = {
  list: ListWithTasks;
  grouping: TaskGrouping;
  /** `useToday().str` from the screen - never a `new Date()` in here. */
  today: string;
};

/**
 * The rows of one list: groups, the completed disclosure, the edit dialog and
 * the delete confirmation. Adding is NOT here any more - the composer is a
 * separate, thumb-reachable component pinned to the bottom of the screen.
 *
 * It owns the three task mutations a row can trigger (tick, rename, delete) so
 * the screens above it stay about the LIST: renaming it, exporting it, opening
 * its info panel. Ticking in particular has to live here, because completion has
 * two homes and only `useToggleTask` knows which one a row writes to - reading
 * `is_completed` for a repeating chore would show it permanently unfinished and
 * writing it would break a CHECK constraint.
 *
 * Every row is wrapped in `SwipeableTaskRow` regardless of viewport. The
 * gesture works fine with a mouse on desktop; the hidden inline action buttons
 * on mobile (handled inside `TaskListRow`) is what makes the gesture-only UX
 * feel mobile-first without disabling power-user clicks on desktop.
 */
export function TaskListBody({ list, grouping, today }: TaskListBodyProps) {
  const [showCompleted, setShowCompleted] = useState(false);

  const toggleTask = useToggleTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { byKey } = useTaskOccurrenceRows();
  const { byTask } = useTaskAssignees();

  // Delete-confirm state, used by both swipe-left and the desktop trash button.
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  // Edit-dialog state. When non-null the `TaskEditDialog` is open on this task.
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Keep the dialog's task in sync with realtime updates: if the cache refetches
  // (e.g. someone else edits the same task) the popup should reflect the latest
  // server state instead of the stale fields it was opened with.
  useEffect(() => {
    if (!editingTask) return;
    const fresh = list.tasks.find((task) => task.id === editingTask.id);
    if (!fresh) {
      // Deleted locally or remotely - close the popup rather than editing a ghost.
      setEditingTask(null);
      return;
    }
    if (fresh !== editingTask) setEditingTask(fresh);
  }, [list.tasks, editingTask]);

  // When a row is ticked, the optimistic update flips it immediately, which would
  // otherwise yank it out of the active section with no visual confirmation. We
  // hold the id for ~600ms so the row stays where it is (now struck through)
  // before sliding into the collapsed completed section. Pure presentation - the
  // mutation fires straight away.
  const [pendingHideIds, setPendingHideIds] = useState<Set<string>>(() => new Set());
  const hideTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timers = hideTimersRef.current;
    return () => {
      for (const handle of timers.values()) window.clearTimeout(handle);
      timers.clear();
    };
  }, []);

  const viewerId = useProfile().profile?.id ?? null;

  const resolved = useMemo<ResolvedTask[]>(
    () =>
      list.tasks.map((task) => {
        const instance = nextTaskInstance(task, today, byKey);
        const occurrenceDate = instance?.occurrenceDate ?? null;
        const assigneeIds = byTask.get(task.id) ?? [];
        const slot = taskTickSlot(task, assigneeIds, viewerId);
        const seriesDate = occurrenceDate ?? today;
        // A chore everybody owes their own tick on has two answers: the circle
        // carries one person's, the "1/3" pill carries the whole thing's. Without
        // the second one, finishing your own part strikes the row for everybody.
        const progress =
          task.completion_mode === "per_assignee" && assigneeIds.length > 1
            ? assigneeProgress(task, assigneeIds, seriesDate, byKey)
            : null;
        const own = slot.aggregate
          ? progress !== null && progress.done === progress.total
          : isTaskDoneOn(task, seriesDate, byKey, slot.personId);
        return {
          task,
          occurrenceDate,
          effectiveDate: instance?.effectiveDate ?? null,
          // The SERIES date, and the same person slot the tick will write to -
          // reading the shared row while writing the viewer's is how a checkbox
          // stops sticking for a `per_assignee` chore.
          done: own,
          // Strike + the completed section follow the WHOLE chore, never one
          // person's part of it.
          rowDone: progress ? progress.done === progress.total : own,
          assigneeIds,
          personId: slot.personId,
          // Inside a list a repeat shows the NEXT instance, which can easily be
          // days out (a weekly chore seen on Wednesday). That one is not
          // finishable here either - same rule as every agenda circle.
          canTick:
            slot.canTick && !isFutureOccurrence(task, instance?.effectiveDate ?? today, today),
          progress,
        };
      }),
    [list.tasks, today, byKey, byTask, viewerId],
  );

  const handleToggle = (row: ResolvedTask) => {
    // Belt and braces: the circle is already disabled for somebody the task was
    // not given to, and the swipe gesture routes here too.
    if (!row.canTick) return;
    const nextDone = !row.done;
    const existing = hideTimersRef.current.get(row.task.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      hideTimersRef.current.delete(row.task.id);
    }
    if (nextDone) {
      setPendingHideIds((prev) => {
        if (prev.has(row.task.id)) return prev;
        const next = new Set(prev);
        next.add(row.task.id);
        return next;
      });
      const handle = window.setTimeout(() => {
        setPendingHideIds((prev) => {
          if (!prev.has(row.task.id)) return prev;
          const next = new Set(prev);
          next.delete(row.task.id);
          return next;
        });
        hideTimersRef.current.delete(row.task.id);
      }, 600);
      hideTimersRef.current.set(row.task.id, handle);
    } else {
      // Un-ticking from the completed section - drop any leftover hide entry so
      // the row doesn't render twice.
      setPendingHideIds((prev) => {
        if (!prev.has(row.task.id)) return prev;
        const next = new Set(prev);
        next.delete(row.task.id);
        return next;
      });
    }
    // The SERIES date, never the effective one: that is what occurrence rows key
    // on, so a moved chore stays ticked under the day the series says it is.
    toggleTask.mutate({
      task: row.task,
      date: row.occurrenceDate ?? today,
      personId: row.personId,
      done: nextDone,
    });
  };

  // Grouped on the WHOLE chore: a task three people owe stays in the active half
  // until the last of them is in, however many parts are already ticked.
  const active = resolved.filter((row) => !row.rowDone || pendingHideIds.has(row.task.id));
  const completed = resolved.filter((row) => row.rowDone && !pendingHideIds.has(row.task.id));

  // Feedback vs history: what you ticked today is worth seeing, what you ticked
  // last month is an archive. One disclosure, two counts.
  const doneToday = completed.filter((row) => (row.task.completed_at ?? "").startsWith(today));
  const doneEarlier = completed.filter((row) => !(row.task.completed_at ?? "").startsWith(today));

  const requestDelete = (task: Task) => setPendingDelete(task);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteTask.mutate(pendingDelete.id);
    setPendingDelete(null);
  };

  // A date chip would only repeat the group header it sits under, so in date
  // grouping the rows stay bare - except the late ones, where "Kasni" names no
  // day and how late it is IS the point.
  const rowProps = (row: ResolvedTask): TaskListRowProps => ({
    canTick: row.canTick,
    progress: row.progress,
    item: row.task,
    done: row.done,
    onToggle: () => handleToggle(row),
    onOpen: (task: Task) => setEditingTask(task),
    onDelete: requestDelete,
    meta: taskRecurrenceLabel(row.task),
    duePill: duePillFor(row, today, grouping !== "date"),
    assigneeIds: row.assigneeIds,
    timeLabel: row.task.due_time ? row.task.due_time.slice(0, 5) : null,
  });

  /** One row with its swipe gestures, no drag handle. */
  const renderRow = (row: ResolvedTask) => (
    <SwipeableTaskRow
      key={row.task.id}
      onSwipeRight={() => handleToggle(row)}
      onSwipeLeft={() => requestDelete(row.task)}
    >
      <TaskListRow {...rowProps(row)} />
    </SwipeableTaskRow>
  );

  // ---------------------------------------------------------------------------
  // Drag-to-reorder - manual grouping only
  // ---------------------------------------------------------------------------
  const reorderable = grouping === "manual";
  const reorderTasks = useReorderTasks();

  // A small activation distance so a quick tap on the handle (e.g. adjusting
  // focus) never starts a drag while any real pull does. Pointer events unify
  // mouse and touch.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragActive, over } = event;
    if (!over || dragActive.id === over.id) return;

    const oldIndex = active.findIndex((row) => row.task.id === dragActive.id);
    const newIndex = active.findIndex((row) => row.task.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // The new global order: reordered active rows in their new positions, then
    // the completed ones keeping their relative order. Every row is renumbered
    // from 1 so `sort_order` stays dense.
    const reorderedActive = arrayMove(active, oldIndex, newIndex);
    const finalOrder = [...reorderedActive, ...completed];
    reorderTasks.mutate(finalOrder.map((row, idx) => ({ id: row.task.id, sort_order: idx + 1 })));
  };

  const handleDialogSubmit = (task: Task, payload: TaskEditPayload) => {
    updateTask.mutate({ id: task.id, payload });
    setEditingTask(null);
  };

  return (
    <>
      <div className="px-2 py-2">
        {active.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            {completed.length === 0
              ? "Lista je prazna. Dodaj prvi zadatak ispod."
              : "Sve je završeno."}
          </p>
        ) : reorderable ? (
          // Sortable flat list - the only mode where the persisted order IS the
          // visual order, so a drop means something.
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={active.map((row) => row.task.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-0.5">
                {active.map((row) => (
                  <SortableActiveRow
                    key={row.task.id}
                    row={row}
                    rowProps={rowProps(row)}
                    onSwipeRight={() => handleToggle(row)}
                    onSwipeLeft={() => requestDelete(row.task)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <GroupedRows rows={active} grouping={grouping} today={today} renderRow={renderRow} />
        )}

        {completed.length > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowCompleted((s) => !s)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              {showCompleted ? (
                <ChevronUpIcon className="h-3.5 w-3.5" />
              ) : (
                <ChevronDownIcon className="h-3.5 w-3.5" />
              )}
              {showCompleted
                ? "Sakrij završene"
                : completedLabel(doneToday.length, doneEarlier.length)}
            </button>
            {showCompleted ? (
              <div className="mt-1 space-y-2">
                {doneToday.length > 0 ? (
                  <div>
                    <SectionHeading as="h3" count={doneToday.length} className="pb-1">
                      Završeno danas
                    </SectionHeading>
                    <ul className="space-y-0.5">{doneToday.map(renderRow)}</ul>
                  </div>
                ) : null}
                {doneEarlier.length > 0 ? (
                  <div>
                    <SectionHeading as="h3" count={doneEarlier.length} className="pb-1">
                      Ranije
                    </SectionHeading>
                    <ul className="space-y-0.5">{doneEarlier.map(renderRow)}</ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Obriši zadatak"
        message={pendingDelete ? `Obrisati „${pendingDelete.name}"?` : ""}
        onConfirm={confirmDelete}
      />

      <TaskEditDialog
        item={editingTask}
        onOpenChange={(open) => {
          if (!open) setEditingTask(null);
        }}
        onSubmit={handleDialogSubmit}
      />
    </>
  );
}

/** "Završeno danas (2) · ranije (14)", dropping whichever half is empty. */
function completedLabel(todayCount: number, earlierCount: number): string {
  const parts: string[] = [];
  if (todayCount > 0) parts.push(`Završeno danas (${todayCount})`);
  if (earlierCount > 0)
    parts.push(todayCount > 0 ? `ranije (${earlierCount})` : `Završeno ranije (${earlierCount})`);
  return parts.join(" · ");
}

/**
 * The chip after the title: the day this row is due, red once it has passed.
 * Nothing at all for an undated row - a shopping list must not grow a date
 * affordance it never asked for.
 */
function duePillFor(
  row: ResolvedTask,
  today: string,
  showWhenOnTime: boolean,
): { label: string; late: boolean } | null {
  const date = row.effectiveDate;
  if (!date) return null;
  const late = date < today;
  if (!late && !showWhenOnTime) return null;
  if (date === today) return { label: "danas", late: false };
  return { label: format(parseISO(`${date}T12:00:00`), "d. MMM", { locale: srLocale }), late };
}

/**
 * Group headers plus rows, for every mode except `manual`. The three modes
 * differ only in how the rows are bucketed, so the rendering is shared: a
 * `SectionHeading` with its count, then a fresh `<ul>` per group (headings
 * between sibling lists rather than as fake list items, which is cleaner for
 * assistive tech).
 */
function GroupedRows({
  rows,
  grouping,
  today,
  renderRow,
}: {
  rows: ResolvedTask[];
  grouping: TaskGrouping;
  today: string;
  renderRow: (row: ResolvedTask) => ReactNode;
}) {
  const { byId } = useFamilyMembers();

  const groups = useMemo<
    Array<{ key: string; label: string; late: boolean; rows: ResolvedTask[] }>
  >(() => {
    if (grouping === "aisle") {
      // `groupByCategory` walks the already aisle-sorted rows (the persisted
      // flag makes `fetchListsWithTasks` sort them), so this just names runs.
      const rowsById = new Map(rows.map((row) => [row.task.id, row]));
      return groupByCategory(rows.map((row) => row.task)).map((group) => ({
        key: group.category,
        label: CATEGORY_LABEL[group.category],
        late: false,
        rows: group.items.flatMap((task) => {
          const row = rowsById.get(task.id);
          return row ? [row] : [];
        }),
      }));
    }

    if (grouping === "person") {
      const buckets = new Map<string, ResolvedTask[]>();
      for (const row of rows) {
        const keys = row.assigneeIds.length > 0 ? row.assigneeIds : [""];
        for (const key of keys) {
          const bucket = buckets.get(key);
          if (bucket) bucket.push(row);
          else buckets.set(key, [row]);
        }
      }
      return (
        [...buckets.entries()]
          .map(([personId, bucket]) => ({
            key: personId || "nobody",
            label: personId ? memberLabel(byId.get(personId)) : "Bez osobe",
            late: false,
            rows: bucket,
          }))
          // Nobody's chores last - they are the family-wide default, not a person.
          .sort((a, b) =>
            a.key === "nobody" ? 1 : b.key === "nobody" ? -1 : a.label.localeCompare(b.label, "sr"),
          )
      );
    }

    // By date: overdue, today, tomorrow, each later day, then the someday pile.
    const tomorrow = shiftIsoByDays(today, 1) ?? today;
    const buckets = new Map<string, ResolvedTask[]>();
    for (const row of rows) {
      const key = row.effectiveDate ?? "";
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row);
      else buckets.set(key, [row]);
    }
    const overdue: ResolvedTask[] = [];
    const dated: Array<{ day: string; rows: ResolvedTask[] }> = [];
    let undated: ResolvedTask[] = [];
    for (const [day, bucket] of buckets) {
      if (day === "") undated = bucket;
      else if (day < today) overdue.push(...bucket);
      else dated.push({ day, rows: bucket });
    }
    dated.sort((a, b) => a.day.localeCompare(b.day));
    overdue.sort((a, b) => (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? ""));

    return [
      ...(overdue.length > 0
        ? [{ key: "overdue", label: "Kasni", late: true, rows: overdue }]
        : []),
      ...dated.map((group) => ({
        key: group.day,
        label: dayGroupLabel(group.day, today, tomorrow),
        late: false,
        rows: group.rows,
      })),
      ...(undated.length > 0
        ? [{ key: "undated", label: "Bez datuma", late: false, rows: undated }]
        : []),
    ];
  }, [rows, grouping, today, byId]);

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.key}>
          <SectionHeading
            as="h3"
            count={group.rows.length}
            tone={group.late ? "neg" : "default"}
            className="pb-1"
          >
            {group.label}
          </SectionHeading>
          <ul className="space-y-0.5">{group.rows.map((row) => renderRow(row))}</ul>
        </div>
      ))}
    </div>
  );
}

function memberLabel(person: { first_name: string | null; last_name: string | null } | undefined) {
  return (
    getDisplayName({
      firstName: person?.first_name ?? null,
      lastName: person?.last_name ?? null,
      email: null,
    }) || "Član"
  );
}

/** "Danas" / "Sutra" / "Čet, 13. avgust" - the day a group of rows is due on. */
function dayGroupLabel(day: string, today: string, tomorrow: string): string {
  if (day === today) return "Danas";
  if (day === tomorrow) return "Sutra";
  const date = parseISO(`${day}T12:00:00`);
  const weekday = format(date, "EEE", { locale: srLocale });
  return `${weekday}, ${format(date, "d. MMMM", { locale: srLocale })}`;
}

/**
 * Sortable wrapper for one active row. Calls `useSortable` per row and threads
 * the resulting drag bindings into `TaskListRow` via its `dragHandle` prop. The
 * outer `<div>` carries the transform dnd-kit animates the row with - kept as a
 * div rather than an `<li>` so it does not double up with the `<li>`
 * `SwipeableTaskRow` renders internally.
 *
 * `SwipeableTaskRow` owns pointer events on touch devices; the drag handle in
 * `TaskListRow` stops `pointerdown` propagation so the swipe gesture does not
 * try to read a drag pull as a horizontal swipe.
 */
function SortableActiveRow({
  row,
  rowProps,
  onSwipeRight,
  onSwipeLeft,
}: {
  row: ResolvedTask;
  rowProps: Omit<TaskListRowProps, "dragHandle">;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id: row.task.id,
  });

  // Strip scaleX/scaleY from the transform string.
  //
  // The default `CSS.Transform.toString` emits
  //   `translate3d(x, y, 0) scaleX(sx) scaleY(sy)`
  // and dnd-kit picks a non-1 scale on the dragged row to match its current
  // "over" slot's size. With rows of varying heights (one has a description
  // preview underneath, another doesn't) the dragged row visibly squishes as it
  // crosses those neighbours. We only want the translate.
  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.6 : undefined,
    // Lift the dragging row above its neighbours so the shadow + outline don't
    // get clipped by sibling rows during the translate animation.
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? "relative" : undefined,
  };
  const dragHandle: DragHandleBindings = { listeners, attributes };

  return (
    <div ref={setNodeRef} style={style}>
      <SwipeableTaskRow
        onSwipeRight={onSwipeRight}
        onSwipeLeft={onSwipeLeft}
        // Suppress swipe gestures while a drag is in progress - touch devices
        // would otherwise read one long pointer trail as both.
        disabled={isDragging}
      >
        <TaskListRow {...rowProps} dragHandle={dragHandle} />
      </SwipeableTaskRow>
    </div>
  );
}
