import {
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ForwardIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { TaskCheckCircle } from "@/components/tasks/TaskCheckCircle";
import { assigneeProgress } from "@/components/tasks/taskItemModel";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import type { Task, TaskOccurrence } from "@/types/database";
import { formatDate, formatDateTime } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";
import {
  expandTaskOccurrences,
  isRecurringTask,
  isTaskDoneOn,
  lateOccurrences,
  taskOccurrenceKey,
  type TaskOccurrenceInstance,
} from "@/utils/task";

/**
 * Bodies for the two sub-views `TaskDetailSheet` pushes onto its sheet stack for
 * a repeating task: what already happened ("Istorija") and what is still owed
 * ("Zaostalo"). Same arrangement as `PaymentHistoryPanel` - pushed views inside
 * the SAME sheet, not second dialogs.
 *
 * The history exists because every per-occurrence action used to be invisible
 * the moment it was taken. Skipping a repeat removed it from every screen in the
 * app while `useRestoreOccurrence` sat implemented and called by nothing, so a
 * skipped day was unreachable: not shown anywhere, and no route back. This is
 * that route, and it is also the only place the app answers "who did that".
 */

/** How far back the history reads. Longer than the debt window on purpose. */
const HISTORY_DAYS = 90;

type HistoryStatus = "done" | "skipped" | "moved" | "missed";

type HistoryEntry = {
  /** The SERIES date - what occurrence rows key on, and what "Vrati" acts on. */
  occurrenceDate: string;
  status: HistoryStatus;
  /** Where it ended up, when a row relocated it. */
  movedToDate: string | null;
  /** Who last put it in this state, and when. */
  actorPersonId: string | null;
  actedAt: string | null;
  /** "2/3" for a chore each assignee ticks separately; null otherwise. */
  progress: { done: number; total: number } | null;
  /** Which of the assignees have already ticked their own copy. */
  doneBy: string[];
};

/**
 * The assignees who have already finished their own copy of one occurrence.
 *
 * Only `per_assignee` has such a thing: under `shared` there is one answer for
 * everybody and `completed_by_person_id` already names whoever wrote it.
 */
function doneAssignees(
  task: Task,
  assigneeIds: string[],
  occurrenceDate: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): string[] {
  if (task.completion_mode !== "per_assignee") return [];
  return assigneeIds.filter((personId) =>
    isTaskDoneOn(task, occurrenceDate, occurrencesByKey, personId),
  );
}

function addDays(dateStr: string, count: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + count);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The whole-occurrence row for a slot - the one that carries structural state. */
function wholeRow(rows: TaskOccurrence[] | undefined): TaskOccurrence | undefined {
  return rows?.find((row) => row.person_id == null);
}

/**
 * Which of the four things happened to one projected instance.
 *
 * Order matters: a slot carries ONE row, so an occurrence that was moved and
 * then ticked reads as done (the tick is the later fact and the more useful
 * one), while a moved occurrence nobody has resolved reads as moved rather than
 * as missed - it is not forgotten, it was deliberately put somewhere else.
 */
function statusOf(
  occurrenceDate: string,
  instance: TaskOccurrenceInstance | undefined,
  row: TaskOccurrence | undefined,
  progress: { done: number; total: number } | null,
): HistoryStatus {
  if (progress) {
    if (progress.done === progress.total && progress.total > 0) return "done";
  } else if (instance?.isDone || row?.status === "done") {
    return "done";
  }
  if (row?.status === "skipped") return "skipped";
  // A relocation ONTO the day it already sat on is not a move. Such a row can be
  // left behind by moving an occurrence and then moving it back, and reporting
  // it read "15.08.2026 - Pomereno na 15.08.2026", which says nothing twice.
  if (row?.moved_to_date && row.moved_to_date !== occurrenceDate) return "moved";
  return "missed";
}

/**
 * Every resolved-or-not instance of a series over the last {@link HISTORY_DAYS},
 * newest first.
 *
 * Built from two sources, because neither alone is the history. The projection
 * supplies the days the series says existed - including the ones with NO row,
 * which is what "Propušteno" is and what makes this a history rather than a dump
 * of the override table. The rows supply what the projection cannot reach: an
 * instance moved OUT of the window, typically forward into next week, which is
 * exactly the action a person is most likely to want to take back.
 */
function useTaskHistory(task: Task | null, assigneeIds: string[], today: string): HistoryEntry[] {
  const { byKey } = useTaskOccurrenceRows();
  if (!task || !isRecurringTask(task)) return [];

  const from = addDays(today, -HISTORY_DAYS);
  const perAssignee = task.completion_mode === "per_assignee" && assigneeIds.length > 0;
  const entries = new Map<string, HistoryEntry>();

  const build = (occurrenceDate: string, instance?: TaskOccurrenceInstance): void => {
    const row = wholeRow(byKey.get(taskOccurrenceKey(task.id, occurrenceDate)));
    const progress = perAssignee
      ? assigneeProgress(task, assigneeIds, occurrenceDate, byKey)
      : null;
    const status = statusOf(occurrenceDate, instance, row, progress);
    // Nothing happened here AND the day has not passed - a row left behind by a
    // move that was undone, or a day still ahead. "Propušteno" would be a lie
    // about a day nobody has missed yet, so it is simply not history.
    if (status === "missed" && occurrenceDate >= today) return;
    const done = status === "done";
    entries.set(occurrenceDate, {
      occurrenceDate,
      status,
      movedToDate: row?.moved_to_date ?? null,
      // A tick names the person who did the work; a skip or a move names the one
      // who made the call. They are different columns because they are different
      // facts - and only the second one is new.
      actorPersonId: (done ? row?.completed_by_person_id : row?.acted_by_person_id) ?? null,
      actedAt: (done ? row?.completed_at : row?.acted_at) ?? null,
      progress,
      doneBy: doneAssignees(task, assigneeIds, occurrenceDate, byKey),
    });
  };

  for (const instance of expandTaskOccurrences(task, from, addDays(today, -1), byKey)) {
    build(instance.occurrenceDate, instance);
  }

  const prefix = `${task.id}|`;
  for (const [key, rows] of byKey) {
    if (!key.startsWith(prefix)) continue;
    const row = wholeRow(rows);
    // Bounded at the near end only. A row for TODAY or for a day still ahead is
    // somebody having skipped or moved it in advance - the action most likely to
    // be wanted back, and the one the projection above can never reach because
    // it only walks the past. Leaving it out is what made a skip made today
    // disappear from every screen in the app, this one included.
    if (!row || row.occurrence_date < from) continue;
    if (entries.has(row.occurrence_date)) continue;
    build(row.occurrence_date);
  }

  // ISO dates sort lexicographically; newest first is how a history is read.
  return [...entries.values()].toSorted((a, b) => b.occurrenceDate.localeCompare(a.occurrenceDate));
}

const STATUS_META: Record<
  HistoryStatus,
  { label: string; icon: typeof CheckCircleIcon; className: string }
> = {
  done: { label: "Završeno", icon: CheckCircleIcon, className: "text-pos" },
  skipped: { label: "Preskočeno", icon: ForwardIcon, className: "text-muted-foreground" },
  moved: { label: "Pomereno", icon: ArrowUturnLeftIcon, className: "text-accent-deep" },
  missed: { label: "Propušteno", icon: QuestionMarkCircleIcon, className: "text-neg" },
};

/**
 * "1/3 · Milan · fali još 2" - who has already ticked their own copy of a chore
 * split between people, and how much of it is still outstanding.
 *
 * Written with the count first and no verb, so it needs no gender agreement for
 * a mixed list of names, and reads the same whether one person is missing or
 * four. Null when there is nothing to say: a `shared` chore has one answer, and
 * that answer is already on the line above.
 */
function progressLine(
  progress: { done: number; total: number } | null,
  doneBy: string[],
  nameOf: (personId: string) => string,
): string | null {
  if (!progress || progress.total === 0 || doneBy.length === 0) return null;
  const names = doneBy.map(nameOf).filter(Boolean).join(", ");
  const missing = progress.total - progress.done;
  const head = `${progress.done}/${progress.total}${names ? ` · ${names}` : ""}`;
  return missing > 0 ? `${head} · fali još ${missing}` : head;
}

export type TaskHistoryListProps = {
  task: Task | null;
  assigneeIds: string[];
  today: string;
  /** Undo a skip or a move - the parent calls `restoreOccurrence`. */
  onRestore: (occurrenceDate: string) => void;
  busy?: boolean;
};

export function TaskHistoryList({
  task,
  assigneeIds,
  today,
  onRestore,
  busy = false,
}: TaskHistoryListProps) {
  const entries = useTaskHistory(task, assigneeIds, today);
  const { byId } = useFamilyMembers();

  const nameOf = (personId: string): string => {
    const person = byId.get(personId);
    return person
      ? getDisplayName({
          firstName: person.first_name,
          lastName: person.last_name,
          email: null,
        })
      : "";
  };

  if (entries.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        Nema zabeleženih ponavljanja u poslednja tri meseca.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const meta = STATUS_META[entry.status];
        const Icon = meta.icon;
        const who = entry.actorPersonId ? nameOf(entry.actorPersonId) : null;
        const shared = progressLine(entry.progress, entry.doneBy, nameOf);
        const label =
          entry.status === "moved" &&
          entry.movedToDate &&
          entry.movedToDate !== entry.occurrenceDate
            ? `${meta.label} na ${formatDate(entry.movedToDate)}`
            : entry.status === "done" && entry.progress
              ? `${meta.label} ${entry.progress.done}/${entry.progress.total}`
              : meta.label;
        // "ko i kada" - either half may be missing on a row written before the
        // stamp existed, so they are joined rather than templated.
        const stamp = [who, entry.actedAt ? formatDateTime(entry.actedAt) : null]
          .filter(Boolean)
          .join(" · ");

        return (
          <li
            key={entry.occurrenceDate}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-4 py-3"
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <Icon className={`mt-0.5 size-4 shrink-0 ${meta.className}`} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {formatDate(entry.occurrenceDate)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stamp ? `${label} · ${stamp}` : label}
                </span>
                {/* Who of the several people it was given to has already done
                    their part, and how much is still missing - the question
                    "Propušteno" on its own answers wrongly when two of three
                    finished. */}
                {shared ? <span className="text-xs text-muted-foreground">{shared}</span> : null}
              </div>
            </div>
            {entry.status === "skipped" || entry.status === "moved" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onRestore(entry.occurrenceDate)}
              >
                Vrati
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export type TaskLateListProps = {
  task: Task | null;
  assigneeIds: string[];
  today: string;
  /** From `taskTickSlot` - only the people a chore was given to may finish it. */
  canTick: boolean;
  onComplete: (occurrenceDate: string) => void;
  onSkip: (occurrenceDate: string) => void;
  busy?: boolean;
};

/**
 * The unresolved past instances of one series, oldest first - what the overdue
 * block's "kasni 3" collapses. Each row resolves ONE day, because that is the
 * unit the debt is owed in; "Preskoči sve zaostalo" lives in the sub-view's
 * footer, in the parent.
 */
export function TaskLateList({
  task,
  assigneeIds,
  today,
  canTick,
  onComplete,
  onSkip,
  busy = false,
}: TaskLateListProps) {
  const { byKey } = useTaskOccurrenceRows();
  const { byId } = useFamilyMembers();
  const late = task ? lateOccurrences(task, today, byKey, assigneeIds) : [];

  const nameOf = (personId: string): string => {
    const person = byId.get(personId);
    return person
      ? getDisplayName({
          firstName: person.first_name,
          lastName: person.last_name,
          email: null,
        })
      : "";
  };

  if (!task || late.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        Nema zaostalih ponavljanja.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {late.map((instance) => {
        // A chore split between people is rarely all-or-nothing when it is late:
        // one of the three usually did do it, and a bare date would hide that
        // from whoever is deciding what to do with the day.
        const progress =
          task.completion_mode === "per_assignee" && assigneeIds.length > 0
            ? assigneeProgress(task, assigneeIds, instance.occurrenceDate, byKey)
            : null;
        const shared = progressLine(
          progress,
          doneAssignees(task, assigneeIds, instance.occurrenceDate, byKey),
          nameOf,
        );
        return (
          <li
            key={instance.occurrenceDate}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <TaskCheckCircle
                done={false}
                name={`${task.name} (${formatDate(instance.effectiveDate)})`}
                disabled={!canTick || busy}
                onToggle={() => onComplete(instance.occurrenceDate)}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {formatDate(instance.effectiveDate)}
                </span>
                {shared ? (
                  <span className="truncate text-xs text-muted-foreground">{shared}</span>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onSkip(instance.occurrenceDate)}
            >
              Preskoči
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
