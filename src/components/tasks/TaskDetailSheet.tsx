import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ArrowRightCircleIcon,
  ArrowUturnLeftIcon,
  BellIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ForwardIcon,
  ListBulletIcon,
  PencilSquareIcon,
  TrashIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

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
import { DetailAuditLine } from "@/components/common/DetailAuditLine";
import { TaskEditForm, type TaskEditPayload } from "@/components/tasks/TaskEditDialog";
import { TaskHistoryList, TaskLateList } from "@/components/tasks/TaskHistoryPanel";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile } from "@/hooks/useProfile";
import { assigneeProgress, taskTickSlot } from "@/components/tasks/taskItemModel";
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
import { formatDate, formatDateTime } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";
import { ponavljanjaLabel, serbianPlural } from "@/utils/plural";
import {
  isFutureOccurrence,
  isRecurringTask,
  isTaskDoneOn,
  isTaskOverdue,
  lateOccurrences,
  taskCompletionOn,
  taskOccurrenceKey,
  taskRecurrenceLabel,
  type TaskCompletionStamp,
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
 *
 * Skipping and moving are facts about the OCCURRENCE, never about one assignee:
 * one row per slot, `person_id IS NULL`. So both of them take the day away from
 * everybody the task was given to, including on a `per_assignee` chore where
 * completion is per person - and every string around them has to say so, which
 * is the whole of plan 017 section 8. Neither closes the sheet any more either:
 * they pop back to the detail, where the badge has flipped and the primary
 * action has become "Vrati ponavljanje", exactly as a tick already behaved.
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
};

type View = "detail" | "date" | "edit" | "delete" | "skip" | "history" | "late";

/**
 * What a pending skip acts on. `dates` are SERIES dates, and there is more than
 * one only for "Preskoči sve zaostalo" - the confirm is the same either way, so
 * there is exactly one place in the app where a skip is explained.
 */
type SkipTarget = { dates: string[]; all: boolean };

/**
 * The skip confirmation, in the same shape as `taskDeleteCopy`: a pure function
 * that hands the sub-view every string it prints.
 *
 * The consequence sentence names the assignees, because that is the fact the
 * shipped copy left out and the one people asked about - a skip is not "mine",
 * it takes the day away from everybody the chore was given to.
 */
export function taskSkipCopy(
  task: Pick<Task, "name">,
  target: SkipTarget,
  assigneeNames: string[],
  /** Assignees who have already ticked their own copy of the target day(s). */
  doneNames: string[] = [],
): { title: string; message: string; confirm: string } {
  const who =
    assigneeNames.length > 0
      ? `za sve kojima je zadatak dodeljen (${assigneeNames.join(", ")})`
      : "za celu porodicu";

  // Somebody's work is on the line, so the confirm says whose - and the promise
  // it makes has to be one the app keeps. It is: a skip writes only the
  // whole-occurrence row, so per-person ticks survive untouched, and
  // `isHiddenBySkip` keeps the day on the list of whoever gave one, struck
  // through. Change either of those and this sentence becomes a lie.
  //
  // A day EVERYBODY has finished cannot be skipped at all; the action is not
  // offered (see `occurrenceDone` in the sheet), so this only ever names some.
  const kept =
    doneNames.length === 0
      ? ""
      : doneNames.length === 1
        ? ` ${doneNames[0]} je već završio/la svoj deo - ta kvačica ostaje zabeležena i dan ostaje na spisku, precrtan.`
        : ` ${doneNames.join(", ")} su već završili svoj deo - te kvačice ostaju zabeležene i dan im ostaje na spisku, precrtan.`;

  if (target.all) {
    // Three agreements off one count, because "2 zaostalih ponavljanja otpada"
    // is not something a person would say.
    const count = target.dates.length;
    const noun = serbianPlural(count, {
      one: "zaostalo ponavljanje",
      few: "zaostala ponavljanja",
      many: "zaostalih ponavljanja",
    });
    const falls = serbianPlural(count, { one: "otpada", few: "otpadaju", many: "otpada" });
    return {
      title: "Preskoči sve zaostalo",
      message: `${count} ${noun} zadatka „${task.name}" ${falls} ${who}. Serija se nastavlja, a možete ih vratiti iz istorije.${kept}`,
      confirm: "Preskoči sve",
    };
  }
  const when = target.dates[0] ? formatDate(target.dates[0]) : "";
  return {
    title: "Preskoči ponavljanje",
    message: `${when} otpada ${who}. Serija se nastavlja, a ovaj dan možete vratiti iz istorije.${kept}`,
    confirm: "Preskoči",
  };
}

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
  /**
   * Whether this occurrence is already finished by everybody it was given to.
   * When it is, the "skip just this one" answer is withdrawn: skipping a day
   * that is DONE would take a finished piece of work off the board, and there is
   * nothing left to skip anyway. Deleting the series stays available.
   */
  occurrenceDone = false,
): TaskDeleteCopy {
  if (!isRecurringTask(task)) {
    return {
      title: "Obriši zadatak",
      message: `Da li ste sigurni da želite da obrišete „${task.name}"? Ova radnja se ne može opozvati.`,
      occurrence: null,
      series: { label: "Obriši", note: "Trajno uklanja zadatak" },
    };
  }

  // A finished day is not a thing you skip, so the two-answer question collapses
  // to the one answer that is still meaningful.
  if (occurrenceDone) {
    return {
      title: "Obriši zadatak",
      message: `„${task.name}" se ponavlja, a ovo ponavljanje je već završeno. Brisanjem se uklanja cela serija.`,
      occurrence: null,
      series: { label: "Obriši", note: "Trajno briše zadatak i sva njegova ponavljanja" },
    };
  }

  const when = occurrenceDate ? ` (${formatDate(occurrenceDate)})` : "";
  return {
    title: "Obriši zadatak",
    message: `„${task.name}" se ponavlja. Obrisati samo ovo ponavljanje${when} ili celu seriju?`,
    // Named for what it actually writes. It used to say "Samo ovo ponavljanje",
    // which made one write reachable under two different words - one of them the
    // word for the destructive action sitting right below it.
    occurrence: {
      label: "Preskoči ovo ponavljanje",
      note: "Ovaj dan otpada za sve, ostala ponavljanja ostaju",
    },
    series: {
      label: "Cela serija",
      note: "Trajno briše zadatak i sva njegova ponavljanja",
    },
  };
}

/**
 * "Ana · 11.08.2026 18:42" - who did something and when, dropping whichever half
 * is missing (a task ticked before the stamp existed has neither, and a member
 * who has since left the family resolves to no name).
 */
function personStampLabel(
  personId: string | null,
  at: string | null,
  peopleById: Map<string, { first_name: string | null; last_name: string | null }>,
): string {
  const person = personId ? peopleById.get(personId) : undefined;
  const name = person
    ? getDisplayName({
        firstName: person.first_name,
        lastName: person.last_name,
        email: null,
      })
    : "";
  const when = at ? formatDateTime(at) : "";
  return [name, when].filter(Boolean).join(" · ") || "-";
}

/** The completion stamp in the same shape. */
function completionLabel(
  stamp: TaskCompletionStamp,
  peopleById: Map<string, { first_name: string | null; last_name: string | null }>,
): string {
  return personStampLabel(stamp.personId, stamp.at, peopleById);
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
}: TaskDetailSheetProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const [newDate, setNewDate] = useState<string | null>(null);
  const [skipTarget, setSkipTarget] = useState<SkipTarget | null>(null);

  const today = useToday().str;
  const { profile } = useProfile();
  const { byId: peopleById } = useFamilyMembers();
  const tasksQuery = useTasksList();
  const { data: lists } = useListsWithTasks();
  const { byKey, skipOccurrence, moveOccurrence, restoreOccurrence } = useTaskOccurrences();
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
  // Whose copy this sheet acts on, and whether this viewer may act at all -
  // the same rule as every row's circle, from `taskTickSlot`.
  const slot = task
    ? taskTickSlot(task, assigneeIds, profile?.id ?? null)
    : { personId: null, canTick: false, aggregate: false };
  const slotPersonId = slot.personId;
  // A dateless task (a plain list item opened from /tasks) still has exactly one
  // completion, and `isTaskDoneOn` / `useToggleTask` both ignore the date for a
  // non-recurring row - so today stands in and the tick keeps working. A
  // recurring task always has a `due_date`, its series anchor, so this only ever
  // falls back for the shape that does not read it.
  const toggleDate = seriesDate ?? today;
  // For a chore split between people this viewer is not one of, the sheet reads
  // the whole thing: finished only when every one of them has finished.
  const progress =
    task && slot.aggregate ? assigneeProgress(task, assigneeIds, toggleDate, byKey) : null;
  const done = progress
    ? progress.done === progress.total
    : !!task && isTaskDoneOn(task, toggleDate, byKey, slotPersonId);
  // Anyone in the family can tick anything off, so a done task owes the others
  // an answer to "by whom, and when".
  const completion = task ? taskCompletionOn(task, toggleDate, byKey, slotPersonId) : null;
  const override =
    task && seriesDate
      ? byKey.get(taskOccurrenceKey(task.id, seriesDate))?.find((row) => row.person_id == null)
      : undefined;
  const movedFrom = override?.status === "moved" ? seriesDate : null;

  // Every unresolved past instance of this series, not just the one the row was
  // opened on: the overdue block collapses them into a single "3 propuštena" row, and
  // this is where that row is unpacked.
  const late = useMemo(
    () => (task && recurring ? lateOccurrences(task, today, byKey, assigneeIds) : []),
    [task, recurring, today, byKey, assigneeIds],
  );
  // Not due yet - the one case the sheet still allows a tick that no list circle
  // does, because "I did it in advance" is real and two taps is its right price.
  const notYetDue = !!task && !!shownDate && isFutureOccurrence(task, shownDate, today);
  const personName = (id: string): string => {
    const person = peopleById.get(id);
    return person
      ? getDisplayName({
          firstName: person.first_name,
          lastName: person.last_name,
          email: null,
        })
      : "";
  };
  const assigneeNames = assigneeIds.map(personName).filter(Boolean);

  /**
   * Whether the occurrence as a WHOLE is finished - not whether this viewer's
   * own part is. `done` above answers for the viewer's slot, which for a
   * `per_assignee` chore is one of several answers; skipping is a fact about the
   * day, so it has to consult all of them.
   */
  const wholeProgress =
    task && task.completion_mode === "per_assignee" && assigneeIds.length > 0
      ? assigneeProgress(task, assigneeIds, toggleDate, byKey)
      : null;
  const occurrenceDone = wholeProgress ? wholeProgress.done === wholeProgress.total : done;

  /**
   * The assignees who have already ticked their own copy of the days about to be
   * skipped. Empty under `shared`, where completion is one answer for everybody
   * and a finished day cannot reach a skip at all.
   */
  const doneNamesFor = (dates: string[]): string[] => {
    if (!task || task.completion_mode !== "per_assignee") return [];
    const ids = new Set<string>();
    for (const date of dates) {
      for (const id of assigneeIds) {
        if (isTaskDoneOn(task, date, byKey, id)) ids.add(id);
      }
    }
    return [...ids].map(personName).filter(Boolean);
  };

  const skipCopy =
    task && skipTarget
      ? taskSkipCopy(task, skipTarget, assigneeNames, doneNamesFor(skipTarget.dates))
      : null;

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
    moveOccurrence.isPending ||
    restoreOccurrence.isPending;

  const deleteCopy = task ? taskDeleteCopy(task, seriesDate, occurrenceDone) : null;

  const handleToggle = () => {
    if (!task || !slot.canTick) return;
    // Deliberately does NOT close: the tick is optimistic, the primary row's
    // label flips to "Vrati u aktivne" under the thumb, and an accidental tap is
    // undone with a second one instead of by re-opening the sheet.
    toggleTask.mutate({ task, date: toggleDate, personId: slotPersonId, done: !done });
  };

  /**
   * Show this instance on `date` - an occurrence override, or the row's own due
   * date. Lands back on the detail rather than closing: the sheet re-reads the
   * row from the cache, so the new date is right there under the title, and the
   * "Vrati ponavljanje" row appears beside it.
   */
  const moveTo = async (date: string) => {
    if (!task || !seriesDate) return;
    try {
      if (recurring) {
        await moveOccurrence.mutateAsync({
          taskId: task.id,
          occurrenceDate: seriesDate,
          movedToDate: date,
        });
        toast.success(`Pomereno na ${formatDate(date)}`, {
          action: { label: "Poništi", onClick: () => void restore(seriesDate) },
        });
      } else {
        await updateTask.mutateAsync({ id: task.id, payload: { due_date: date } });
      }
      // From "Izaberi datum" this returns to the detail; from the one-tap
      // "Pomeri na sutra" there is nothing above the detail, so it is a no-op.
      pop();
    } catch {
      // Error toast surfaced by the hook; the sheet stays open to retry.
    }
  };

  /**
   * Skip one instance, or every unresolved one behind it. Sequential rather than
   * batched: `skipOccurrence` is an upsert of a single slot, and one failure
   * mid-run should leave the earlier days genuinely skipped rather than roll an
   * imaginary transaction back.
   */
  const handleSkip = async (target: SkipTarget) => {
    if (!task || target.dates.length === 0) return;
    try {
      for (const date of target.dates) {
        await skipOccurrence.mutateAsync({ taskId: task.id, occurrenceDate: date });
      }
      setSkipTarget(null);
      pop();
      toast.success(
        target.dates.length === 1
          ? "Ponavljanje preskočeno"
          : `Preskočeno ponavljanja: ${target.dates.length}`,
        {
          action: {
            label: "Poništi",
            onClick: () => {
              for (const date of target.dates)
                restoreOccurrence.mutate({ taskId: task.id, occurrenceDate: date });
            },
          },
        },
      );
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  /**
   * Undo a skip or a move - back to whatever the series says. Deliberately not a
   * way to untick: `useRestoreOccurrence` filters on the two structural statuses,
   * and completion is `useToggleTask`'s to remove.
   */
  const restore = async (occurrenceDate: string) => {
    if (!task) return;
    try {
      await restoreOccurrence.mutateAsync({ taskId: task.id, occurrenceDate });
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  /**
   * Tick or untick one late instance from the "Zaostalo" list, under its OWN
   * series date. `done` comes from the row, which reads the same slot this
   * writes - so a day the viewer has already finished unticks rather than
   * re-sending "finish it" and changing nothing.
   */
  const completeLate = (occurrenceDate: string, done: boolean) => {
    if (!task || !slot.canTick) return;
    toggleTask.mutate({ task, date: occurrenceDate, personId: slotPersonId, done });
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

  const handleEditSubmit = async (payload: TaskEditPayload) => {
    if (!task) return;
    try {
      await updateTask.mutateAsync({ id: task.id, payload });
      // Back to the detail, not out of the flow: the sheet re-reads the row from
      // the cache, so the change is right there under the title you edited it
      // from.
      pop();
    } catch {
      // Error toast surfaced by the hook; the form stays open with the input.
    }
  };

  const listName = task?.list_id
    ? (lists?.find((list) => list.id === task.list_id)?.name ?? null)
    : null;
  const reminder = task ? reminderLabel(task) : null;
  const dueTime = task?.due_time ? normalizeTime(task.due_time) : null;
  const whenLabel = shownDate
    ? `${formatDate(shownDate)}${dueTime ? ` u ${dueTime}` : ""}`
    : "Bez datuma";

  const skipped = override?.status === "skipped";

  const statusBadges: DetailBadge[] = [];
  if (task) {
    if (done) {
      statusBadges.push({ label: "Završeno", tone: "pos" });
    } else if (skipped) {
      // The one state the agenda cannot show, since it drops skipped instances -
      // so the sheet you are left standing in after a skip has to say it.
      statusBadges.push({ label: "Preskočeno", tone: "neutral" });
    } else if (missed) {
      statusBadges.push({ label: "Propušteno", tone: "neg" });
    } else if (isTaskOverdue(task, today)) {
      statusBadges.push({ label: "Kasni", tone: "neg" });
    } else if (late.length > 0) {
      statusBadges.push({ label: `Kasni ${late.length}`, tone: "neg" });
    }
    if (movedFrom) {
      statusBadges.push({ label: `Pomereno sa ${formatDate(movedFrom)}`, tone: "accent" });
    }
    if (task.completion_mode === "per_assignee") {
      statusBadges.push({
        label: progress ? `Svako svoje · ${progress.done}/${progress.total}` : "Svako svoje",
        tone: "info",
      });
    }
  }

  const titleFor = (view: View) =>
    view === "date"
      ? "Izaberi datum"
      : view === "edit"
        ? "Izmeni zadatak"
        : view === "delete"
          ? (deleteCopy?.title ?? "Obriši zadatak")
          : view === "skip"
            ? (skipCopy?.title ?? "Preskoči ponavljanje")
            : view === "history"
              ? "Istorija"
              : view === "late"
                ? "Zaostalo"
                : "Detalji zadatka";

  /** Open the skip confirm for one day, or for every unresolved one behind it. */
  const askSkip = (dates: string[], all = false) => {
    setSkipTarget({ dates, all });
    push("skip");
  };

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
                <div className="space-y-3">
                  {/* A move is a fact about the OCCURRENCE, so it takes the day
                      away from everybody it was given to - the same sentence the
                      skip confirm carries, for the same reason. */}
                  {recurring ? (
                    <p className="text-sm text-muted-foreground">
                      {assigneeNames.length > 0
                        ? `Pomera se za sve kojima je zadatak dodeljen (${assigneeNames.join(", ")}).`
                        : "Pomera se za celu porodicu."}
                    </p>
                  ) : null}
                  <DateField
                    id="task-detail-date"
                    label={recurring ? "Novi datum ovog ponavljanja" : "Novi rok"}
                    value={newDate}
                    onChange={setNewDate}
                    placeholder="Izaberi datum"
                  />
                </div>
              ) : view === "skip" ? (
                <p className="text-sm text-muted-foreground">{skipCopy?.message}</p>
              ) : view === "history" ? (
                <TaskHistoryList
                  task={task}
                  assigneeIds={assigneeIds}
                  today={today}
                  onRestore={(date) => {
                    void restore(date);
                  }}
                  busy={saving}
                />
              ) : view === "late" ? (
                <TaskLateList
                  task={task}
                  assigneeIds={assigneeIds}
                  today={today}
                  personId={slotPersonId}
                  canTick={slot.canTick}
                  blockedReason="Ovo mogu da završe samo oni kojima je zadatak dodeljen."
                  onComplete={completeLate}
                  onSkip={(date) => askSkip([date])}
                  busy={saving}
                />
              ) : view === "edit" ? (
                <TaskEditForm
                  task={task}
                  formId="task-detail-edit"
                  onSubmit={(payload) => {
                    void handleEditSubmit(payload);
                  }}
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
                        // Into the SAME confirm the "Preskoči" action row uses:
                        // one write, one name, one explanation of it.
                        onClick={() => {
                          if (seriesDate) askSkip([seriesDate]);
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
                    {completion ? (
                      <DetailInfoText
                        label="Završio"
                        icon={CheckCircleIcon}
                        value={completionLabel(completion, peopleById)}
                      />
                    ) : null}
                    {/* No "Zaostalo" row here: the action row below already says
                        how many are waiting AND opens them. Two lines for one
                        fact, one of which cannot be acted on, is just noise. */}
                    {/* Authorship used to sit here as two more rows in an
                        already long facts card, under the label "Kreirao/la" -
                        the slash being an admission that the app cannot know
                        which form to use. It moved to `DetailAuditLine` at the
                        bottom of the sheet, where every other module now says
                        the same thing the same way and no verb needs a gender
                        (plan 018). */}
                  </DetailInfoRows>

                  <DetailActionList>
                    {/* Only the people a task was given to may finish it. For
                        somebody else the row stays, greyed and saying why -
                        hiding it would read as "this cannot be done at all". */}
                    {/* A skipped or moved instance leads with the way back,
                        because that is what somebody who landed here after the
                        action - or came looking for it from the history - is
                        here to do. */}
                    {skipped || movedFrom ? (
                      <DetailActionRow
                        icon={ArrowUturnLeftIcon}
                        label="Vrati ponavljanje"
                        description={
                          skipped
                            ? `Ponovo se prikazuje ${seriesDate ? formatDate(seriesDate) : ""}`.trim()
                            : `Vraća se na ${seriesDate ? formatDate(seriesDate) : "svoj datum"}`
                        }
                        onClick={() => {
                          if (seriesDate) void restore(seriesDate);
                        }}
                        disabled={saving}
                        tone="primary"
                      />
                    ) : null}
                    <DetailActionRow
                      icon={done ? ArrowUturnLeftIcon : CheckIcon}
                      label={done ? "Vrati u aktivne" : "Označi kao završeno"}
                      description={
                        !slot.canTick
                          ? "Ovo mogu da završe samo oni kojima je dodeljeno"
                          : done
                            ? "Ponovo je na spisku"
                            : notYetDue
                              ? // The list circle refuses this one; here it is
                                // allowed but has to say what it is agreeing to.
                                `Rok je tek ${formatDate(shownDate as string)}`
                              : recurring
                                ? "Samo ovo ponavljanje"
                                : "Beleži da je obavljeno"
                      }
                      onClick={handleToggle}
                      disabled={saving || !slot.canTick}
                      tone={skipped || movedFrom ? "default" : "primary"}
                    />
                    {late.length > 0 ? (
                      <DetailActionRow
                        icon={ExclamationTriangleIcon}
                        label="Prikaži zaostalo"
                        description={`${late.length} ${ponavljanjaLabel(late.length)} čeka na odgovor`}
                        onClick={() => push("late")}
                        disabled={saving}
                        chevron
                      />
                    ) : null}
                    {canSnooze && tomorrow ? (
                      <DetailActionRow
                        icon={ArrowRightCircleIcon}
                        label="Pomeri na sutra"
                        description={
                          recurring
                            ? `${formatDate(tomorrow)} · za sve kojima je dodeljeno`
                            : formatDate(tomorrow)
                        }
                        onClick={() => {
                          void moveTo(tomorrow);
                        }}
                        disabled={saving}
                      />
                    ) : null}
                    <DetailActionRow
                      icon={CalendarDaysIcon}
                      label="Izaberi datum"
                      description={
                        recurring ? "Pomera ovo ponavljanje, za sve" : "Menja rok zadatka"
                      }
                      onClick={() => {
                        setNewDate(shownDate ?? null);
                        push("date");
                      }}
                      disabled={saving}
                      chevron
                    />
                    {/* Not offered once the day is finished by everybody it was
                        given to. A skip there would cancel work that is already
                        done - and since skip and completion share one slot, it
                        would quietly take somebody's tick with it. Untick first
                        if that is really what you meant. */}
                    {recurring && !skipped && !occurrenceDone ? (
                      <DetailActionRow
                        icon={ForwardIcon}
                        label="Preskoči ovo ponavljanje"
                        description={
                          wholeProgress && wholeProgress.done > 0
                            ? `Otpada za ostale; ${wholeProgress.done}/${wholeProgress.total} već završeno`
                            : "Ovaj dan otpada za sve, serija se nastavlja"
                        }
                        onClick={() => {
                          if (seriesDate) askSkip([seriesDate]);
                        }}
                        disabled={saving}
                        chevron
                      />
                    ) : null}
                    {recurring ? (
                      <DetailActionRow
                        icon={ClockIcon}
                        label="Istorija"
                        description="Završeno, preskočeno, pomereno i ko je to uradio"
                        onClick={() => push("history")}
                        disabled={saving}
                        chevron
                      />
                    ) : null}
                    <DetailActionRow
                      icon={PencilSquareIcon}
                      label="Izmeni zadatak"
                      description="Naziv, rok, ponavljanje, za koga, podsetnik…"
                      onClick={() => push("edit")}
                      disabled={saving}
                      chevron
                    />
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

                  <DetailAuditLine row={task} />
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
          ) : view === "edit" ? (
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={saving}>
                Odustani
              </Button>
              {/* Submits the form above through its id, so the button can live
                  outside the scroll area the fields sit in. */}
              <Button type="submit" form="task-detail-edit" disabled={saving}>
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
          ) : view === "skip" ? (
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={saving}>
                Nazad
              </Button>
              <Button
                onClick={() => {
                  if (skipTarget) void handleSkip(skipTarget);
                }}
                disabled={saving || !skipTarget}
              >
                {skipCopy?.confirm ?? "Preskoči"}
              </Button>
            </ResponsiveDialogFooter>
          ) : view === "late" ? (
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={saving}>
                Nazad
              </Button>
              {/* Same confirm as a single skip, which is the point of routing
                  every skip through one view: this one just carries more days. */}
              <Button
                variant="outline"
                onClick={() =>
                  askSkip(
                    late.map((instance) => instance.occurrenceDate),
                    true,
                  )
                }
                disabled={saving || late.length === 0}
              >
                Preskoči sve zaostalo
              </Button>
            </ResponsiveDialogFooter>
          ) : null}
        </ResponsiveDialogContent>
      )}
    />
  );
}
