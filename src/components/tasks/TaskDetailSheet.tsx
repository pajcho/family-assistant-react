import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ArrowRightCircleIcon,
  ArrowUturnLeftIcon,
  BellIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  CheckIcon,
  ForwardIcon,
  ListBulletIcon,
  PencilSquareIcon,
  TrashIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { DateField } from "@/components/common/DateField";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailDeleteBody,
  DetailDeleteFooter,
  DetailHero,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
  type DetailBadge,
} from "@/components/common/DetailSheet";
import { MemberBadges } from "@/components/common/MemberBadges";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { useProfile } from "@/hooks/useProfile";
import { useTaskOccurrences } from "@/hooks/useTaskOccurrences";
import {
  useDeleteTask,
  useListsWithTasks,
  useTasksList,
  useToggleTask,
  useUpdateTask,
} from "@/hooks/useTasks";
import type { Task } from "@/types/database";
import { normalizeTime } from "@/utils/activity";
import { formatDate } from "@/utils/date";
import {
  isRecurringTask,
  isTaskDoneOn,
  isTaskOverdue,
  taskOccurrenceKey,
  taskRecurrenceLabel,
} from "@/utils/task";
import { useToday } from "@/hooks/useToday";
import { shiftIsoByDays } from "@/utils/pickerGrid";

/**
 * THE task detail popup - one look wherever a task row is tapped (Danas,
 * Kalendar, the overdue block, the /tasks screens).
 *
 * Follows the shared detail-sheet convention: the facts on top (hero, state
 * badges, label-value rows), then every action as its own thumb-sized row with
 * the primary FIRST and `Obriši` LAST. "Izaberi datum" and the delete question
 * open as sub-views on the sheet stack - a new overlay ON TOP with a "←" header,
 * so a dismissal there goes back one level instead of closing the flow.
 *
 * Every write keys on the SERIES date (`occurrenceDate`), never on the date the
 * instance is shown at: that is what `task_occurrences` rows are keyed by, so a
 * moved occurrence is still ticked, skipped and re-moved under the date the
 * series says it belongs to.
 *
 * Recurring and one-off diverge in three places, and only here:
 *   - move: recurring writes a 'moved' occurrence; a one-off edits `due_date`;
 *   - skip: recurring only (a one-off has nothing to skip - you delete it);
 *   - delete: recurring asks "this occurrence or the whole series", where the
 *     first answer is a skip and the second the row itself.
 */
export type TaskDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  /**
   * The SERIES date of the instance that was tapped. Null only for a task with
   * no date at all, which has a single implicit occurrence and no per-occurrence
   * actions.
   */
  occurrenceDate: string | null;
  /** Where the instance is actually shown - differs when an override moved it. */
  effectiveDate?: string | null;
  assigneeIds?: string[];
  /** A past recurring instance nobody resolved, straight off the agenda item. */
  missed?: boolean;
  /**
   * Hands the full form back to the host. Omitted → the sheet leaves "Izmeni"
   * out rather than opening a form it cannot own.
   */
  onEdit?: (task: Task) => void;
};

type View = "detail" | "date" | "delete";

/**
 * The delete question, in the shape `paymentCancelCopy` established: a pure
 * function that hands the sub-view every string it prints, so the branching
 * lives here and not inside the JSX.
 *
 * A recurring task asks WHICH of the two things you meant, because they are not
 * variations of one action: skipping an occurrence leaves the chore standing,
 * deleting the row takes every future repetition with it.
 */
export type TaskDeleteCopy = {
  title: string;
  message: string;
  /** The "just this one" answer - recurring tasks only. */
  occurrence: { label: string; note: string } | null;
  series: { label: string; note: string };
};

export function taskDeleteCopy(
  task: Pick<Task, "name" | "recurrence_period">,
  occurrenceDate: string | null,
): TaskDeleteCopy {
  if (!isRecurringTask(task)) {
    return {
      title: "Obriši zadatak",
      message: `Da li ste sigurni da želite da obrišete „${task.name}"? Ova radnja se ne može opozvati.`,
      occurrence: null,
      series: { label: "Obriši", note: "Trajno uklanja zadatak" },
    };
  }

  const when = occurrenceDate ? ` (${formatDate(occurrenceDate)})` : "";
  return {
    title: "Obriši zadatak",
    message: `„${task.name}" se ponavlja. Obrisati samo ovo ponavljanje${when} ili celu seriju?`,
    occurrence: {
      label: "Samo ovo ponavljanje",
      note: "Preskače ovaj dan, ostala ponavljanja ostaju",
    },
    series: {
      label: "Cela serija",
      note: "Trajno briše zadatak i sva njegova ponavljanja",
    },
  };
}

/** The reminder offset in words - the labels the task form's presets carry. */
function reminderLabel(task: Task): string | null {
  if (task.remind_minutes_before != null) {
    return `${task.remind_minutes_before} minuta ranije`;
  }
  if (task.remind_days_before == null) return null;
  if (task.remind_days_before === 0) return "Na dan roka";
  if (task.remind_days_before === 1) return "Dan pre";
  if (task.remind_days_before === 7) return "Nedelju dana pre";
  return `${task.remind_days_before} dana pre`;
}

/** The hero's sub-line: the repeat rule, or the fact that there is none. */
function taskSubtitle(task: Task): string {
  return taskRecurrenceLabel(task) ?? "Jednokratan zadatak";
}

export function TaskDetailSheet({
  open,
  onOpenChange,
  task: subject,
  occurrenceDate,
  effectiveDate,
  assigneeIds = [],
  missed = false,
  onEdit,
}: TaskDetailSheetProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const [newDate, setNewDate] = useState<string | null>(null);

  const today = useToday().str;
  const { profile } = useProfile();
  const tasksQuery = useTasksList();
  const { data: lists } = useListsWithTasks();
  const { byKey, skipOccurrence, moveOccurrence } = useTaskOccurrences();
  const toggleTask = useToggleTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  // Read the freshest copy of the row from the shared cache rather than the one
  // the tapped row captured: ticking from inside the sheet has to flip its own
  // primary action's label, and the optimistic update lands in the cache.
  const task = useMemo(
    () => (subject ? (tasksQuery.data?.find((row) => row.id === subject.id) ?? subject) : null),
    [subject, tasksQuery.data],
  );

  // Back to the root view whenever the subject changes underneath.
  useEffect(() => {
    reset();
  }, [subject, occurrenceDate, reset]);

  const seriesDate = occurrenceDate ?? task?.due_date ?? null;
  const shownDate = effectiveDate ?? seriesDate;
  const recurring = !!task && isRecurringTask(task);
  const perAssignee = task?.completion_mode === "per_assignee";
  // Whose copy this sheet acts on. Same rule as the row's circle: the viewer's
  // own, unless the chore has exactly one assignee and the viewer is not it.
  const slotPersonId = !perAssignee
    ? null
    : profile?.id && assigneeIds.includes(profile.id)
      ? profile.id
      : assigneeIds.length === 1
        ? assigneeIds[0]
        : (profile?.id ?? null);
  // A dateless task (a plain list item opened from /tasks) still has exactly one
  // completion, and `isTaskDoneOn` / `useToggleTask` both ignore the date for a
  // non-recurring row - so today stands in and the tick keeps working. A
  // recurring task always has a `due_date`, its series anchor, so this only ever
  // falls back for the shape that does not read it.
  const toggleDate = seriesDate ?? today;
  const done = !!task && isTaskDoneOn(task, toggleDate, byKey, slotPersonId);
  const override =
    task && seriesDate
      ? byKey.get(taskOccurrenceKey(task.id, seriesDate))?.find((row) => row.person_id == null)
      : undefined;
  const movedFrom = override?.status === "moved" ? seriesDate : null;

  const tomorrow = shiftIsoByDays(today, 1);
  // "Pomeri" means postpone, so the shortcut is only offered while it actually
  // pushes the instance forward - today or already behind. Anything further out
  // is what "Izaberi datum" is for; a one-tap row that quietly pulled a task
  // from next week back to tomorrow would be the opposite of what it says.
  const canSnooze = !!tomorrow && !!shownDate && shownDate <= today;

  const saving =
    toggleTask.isPending ||
    updateTask.isPending ||
    deleteTask.isPending ||
    skipOccurrence.isPending ||
    moveOccurrence.isPending;

  const deleteCopy = task ? taskDeleteCopy(task, seriesDate) : null;

  const handleToggle = () => {
    if (!task) return;
    // Deliberately does NOT close: the tick is optimistic, the primary row's
    // label flips to "Vrati u aktivne" under the thumb, and an accidental tap is
    // undone with a second one instead of by re-opening the sheet.
    toggleTask.mutate({ task, date: toggleDate, personId: slotPersonId, done: !done });
  };

  /** Show this instance on `date` - an occurrence override, or the row's own due date. */
  const moveTo = async (date: string) => {
    if (!task || !seriesDate) return;
    try {
      if (recurring) {
        await moveOccurrence.mutateAsync({
          taskId: task.id,
          occurrenceDate: seriesDate,
          movedToDate: date,
        });
      } else {
        await updateTask.mutateAsync({ id: task.id, payload: { due_date: date } });
      }
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook; the sheet stays open to retry.
    }
  };

  const handleSkip = async () => {
    if (!task || !seriesDate) return;
    try {
      await skipOccurrence.mutateAsync({ taskId: task.id, occurrenceDate: seriesDate });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleDeleteSeries = async () => {
    if (!task) return;
    try {
      await deleteTask.mutateAsync(task.id);
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleEdit = () => {
    if (!task || !onEdit) return;
    onOpenChange(false);
    onEdit(task);
  };

  const listName = task?.list_id
    ? (lists?.find((list) => list.id === task.list_id)?.name ?? null)
    : null;
  const reminder = task ? reminderLabel(task) : null;
  const dueTime = task?.due_time ? normalizeTime(task.due_time) : null;
  const whenLabel = shownDate
    ? `${formatDate(shownDate)}${dueTime ? ` u ${dueTime}` : ""}`
    : "Bez datuma";

  const statusBadges: DetailBadge[] = [];
  if (task) {
    if (done) {
      statusBadges.push({ label: "Završeno", tone: "pos" });
    } else if (missed) {
      statusBadges.push({ label: "Propušteno", tone: "neg" });
    } else if (isTaskOverdue(task, today)) {
      statusBadges.push({ label: "Kasni", tone: "neg" });
    }
    if (movedFrom) {
      statusBadges.push({ label: `Pomereno sa ${formatDate(movedFrom)}`, tone: "accent" });
    }
    if (perAssignee) {
      statusBadges.push({ label: "Svako svoje", tone: "info" });
    }
  }

  const titleFor = (view: View) =>
    view === "date"
      ? "Izaberi datum"
      : view === "delete"
        ? (deleteCopy?.title ?? "Obriši zadatak")
        : "Detalji zadatka";

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent>
          <SheetStackHeader
            title={titleFor(view)}
            srOnly={level === 0}
            onBack={level === 0 ? undefined : pop}
          />
          {task ? (
            <div className="space-y-4">
              {/* Root only: a stacked sub-view sits ON TOP of this sheet, which
                  already names the subject right above it. */}
              {level === 0 ? (
                <DetailHero
                  icon={CheckCircleIcon}
                  // `DetailTone` has no violet, so the task colour comes in
                  // through the documented class escape hatch.
                  iconWrapClassName="bg-task-soft text-task"
                  title={task.name}
                  titleClassName={done ? "text-muted-foreground line-through" : undefined}
                  subtitle={taskSubtitle(task)}
                />
              ) : null}

              {view === "date" ? (
                <DateField
                  id="task-detail-date"
                  label={recurring ? "Novi datum ovog ponavljanja" : "Novi rok"}
                  value={newDate}
                  onChange={setNewDate}
                  placeholder="Izaberi datum"
                />
              ) : view === "delete" ? (
                deleteCopy?.occurrence ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">{deleteCopy.message}</p>
                    <DetailActionList>
                      <DetailActionRow
                        icon={ForwardIcon}
                        label={deleteCopy.occurrence.label}
                        description={deleteCopy.occurrence.note}
                        onClick={() => {
                          void handleSkip();
                        }}
                        disabled={saving}
                      />
                      <DetailActionRow
                        icon={TrashIcon}
                        label={deleteCopy.series.label}
                        description={deleteCopy.series.note}
                        onClick={() => {
                          void handleDeleteSeries();
                        }}
                        disabled={saving}
                        tone="destructive"
                      />
                    </DetailActionList>
                  </div>
                ) : (
                  <DetailDeleteBody name={task.name} />
                )
              ) : (
                <>
                  <DetailBadgeRow badges={statusBadges} />

                  {/* "Kada" is always there (an undated task says so), so the
                      card never renders empty. */}
                  <DetailInfoRows>
                    <DetailInfoText
                      label="Kada"
                      icon={CalendarDaysIcon}
                      value={whenLabel}
                      valueClassName={shownDate ? undefined : "font-normal"}
                    />
                    {recurring ? (
                      <DetailInfoText
                        label="Ponavljanje"
                        icon={ArrowPathIcon}
                        value={taskRecurrenceLabel(task) ?? "-"}
                      />
                    ) : null}
                    {assigneeIds.length > 0 ? (
                      <DetailInfoRow label="Za koga" icon={UserGroupIcon}>
                        <MemberBadges personIds={assigneeIds} />
                      </DetailInfoRow>
                    ) : null}
                    {reminder ? (
                      <DetailInfoText label="Podsetnik" icon={BellIcon} value={reminder} />
                    ) : null}
                    {listName ? (
                      <DetailInfoText label="Lista" icon={ListBulletIcon} value={listName} />
                    ) : null}
                    {task.description ? (
                      <DetailInfoText label="Opis" value={task.description} />
                    ) : null}
                  </DetailInfoRows>

                  <DetailActionList>
                    <DetailActionRow
                      icon={done ? ArrowUturnLeftIcon : CheckIcon}
                      label={done ? "Vrati u aktivne" : "Označi kao završeno"}
                      description={
                        done
                          ? "Ponovo je na spisku"
                          : recurring
                            ? "Samo ovo ponavljanje"
                            : "Beleži da je obavljeno"
                      }
                      onClick={handleToggle}
                      disabled={saving}
                      tone="primary"
                    />
                    {canSnooze && tomorrow ? (
                      <DetailActionRow
                        icon={ArrowRightCircleIcon}
                        label="Pomeri na sutra"
                        description={formatDate(tomorrow)}
                        onClick={() => {
                          void moveTo(tomorrow);
                        }}
                        disabled={saving}
                      />
                    ) : null}
                    <DetailActionRow
                      icon={CalendarDaysIcon}
                      label="Izaberi datum"
                      description={recurring ? "Pomera samo ovo ponavljanje" : "Menja rok zadatka"}
                      onClick={() => {
                        setNewDate(shownDate ?? null);
                        push("date");
                      }}
                      disabled={saving}
                      chevron
                    />
                    {recurring ? (
                      <DetailActionRow
                        icon={ForwardIcon}
                        label="Preskoči ovo ponavljanje"
                        description="Ovaj dan otpada, serija se nastavlja"
                        onClick={() => {
                          void handleSkip();
                        }}
                        disabled={saving}
                      />
                    ) : null}
                    {onEdit ? (
                      <DetailActionRow
                        icon={PencilSquareIcon}
                        label="Izmeni zadatak"
                        description="Naziv, rok, ponavljanje, za koga, podsetnik…"
                        onClick={handleEdit}
                        disabled={saving}
                      />
                    ) : null}
                    <DetailActionRow
                      icon={TrashIcon}
                      label="Obriši zadatak"
                      description={
                        recurring ? "Ovo ponavljanje ili celu seriju" : "Trajno uklanja zadatak"
                      }
                      onClick={() => push("delete")}
                      disabled={saving}
                      tone="destructive"
                    />
                  </DetailActionList>
                </>
              )}
            </div>
          ) : null}

          {view === "date" ? (
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={saving}>
                Nazad
              </Button>
              <Button
                onClick={() => {
                  if (newDate) void moveTo(newDate);
                }}
                disabled={saving || !newDate || newDate === shownDate}
              >
                Sačuvaj
              </Button>
            </ResponsiveDialogFooter>
          ) : view === "delete" && !deleteCopy?.occurrence ? (
            <DetailDeleteFooter
              deleting={saving}
              onBack={pop}
              onConfirm={() => {
                void handleDeleteSeries();
              }}
            />
          ) : view === "delete" ? (
            <ResponsiveDialogFooter>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={pop}
                disabled={saving}
              >
                Nazad
              </Button>
            </ResponsiveDialogFooter>
          ) : null}
        </ResponsiveDialogContent>
      )}
    />
  );
}
