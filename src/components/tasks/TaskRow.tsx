import {
  ItemCard,
  ItemMain,
  ItemMeta,
  ItemSide,
  ItemTime,
  ItemTitle,
} from "@/components/common/ItemCard";
import { MemberBadges } from "@/components/common/MemberBadges";
import { Pill } from "@/components/common/Pill";
import { TaskCheckCircle } from "@/components/tasks/TaskCheckCircle";
import { cn } from "@/lib/cn";
import type { AgendaItem } from "@/hooks/useAgenda";
import { useProfile } from "@/hooks/useProfile";
import { useListsWithTasks, useToggleTask } from "@/hooks/useTasks";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { assigneeProgress, taskTickSlot } from "@/components/tasks/taskItemModel";
import { useToday } from "@/hooks/useToday";
import { formatDate } from "@/utils/date";
import { pluralSr } from "@/utils/plural";
import { isFutureOccurrence, isTaskDoneOn, taskRecurrenceLabel } from "@/utils/task";

/**
 * A dated task as an agenda row - the one row in the app whose LEADING slot is
 * a control instead of a glyph tile.
 *
 * That swap is the feature: ticking a chore off is the thing a person came to
 * do, so the circle takes the reachable position at the head of the row and the
 * trailing slot keeps the clock. The tile a task would otherwise get is
 * redundant anyway - the circle already says "this is something to finish".
 *
 * The circle is a `<label>`-wrapped checkbox rendered as `ItemCard`'s `leading`
 * SIBLING of the row button, the same markup `TaskListRow` has always used: a
 * control nested inside a button is invalid HTML and the browser swallows its
 * clicks. So the two taps never collide - the circle completes without
 * navigating, the row body opens `TaskDetailSheet`.
 */

export type TaskAgendaItem = Extract<AgendaItem, { kind: "task" }>;

export type TaskRowProps = {
  item: TaskAgendaItem;
  /** Row-body tap - the host opens the detail sheet. Never fired by the circle. */
  onClick: () => void;
  /** The deadline that already passed, for the overdue block's rows. */
  dateLabel?: string;
  /**
   * Trailing clock. Off where the surface prints the time itself (Danas'
   * timeline has it in the left gutter), so the row never says it twice.
   */
  showTime?: boolean;
  /**
   * The parent list's name in the meta line. On everywhere the row appears
   * OUTSIDE its list (the agenda, the smart lists); off inside the list itself,
   * where every row would repeat the heading above it.
   */
  showListName?: boolean;
};

export function TaskRow({
  item,
  onClick,
  dateLabel,
  showTime = true,
  showListName = true,
}: TaskRowProps) {
  const { task } = item;
  const toggle = useToggleTask();
  const { personId, circleDone, rowDone, canTick, blockedReason, progress } =
    useTaskCompletionSlot(item);
  const listName = useTaskListName(showListName ? task.list_id : null);

  // A done row is never also "propušteno": it was resolved, just late.
  const missed = item.missed && !rowDone;
  // Only reachable for somebody who had already finished their part before the
  // day was called off (`isHiddenBySkip`), so the row reads as settled: struck
  // through like a done one, and labelled, or it would look like an ordinary
  // completion and leave them wondering where everybody else went.
  const skipped = item.skipped === true;
  const meta = [taskRecurrenceLabel(task), listName, dateLabel ? `rok ${dateLabel}` : null].filter(
    Boolean,
  );

  return (
    <ItemCard
      onClick={onClick}
      dimmed={rowDone || skipped}
      ariaLabel={`Otvori detalje za „${task.name}"`}
      leading={
        <TaskCheckCircle
          done={circleDone}
          name={task.name}
          disabled={!canTick || skipped}
          disabledReason={
            skipped ? "Ovaj dan je preskočen. Otvorite zadatak da biste ga vratili." : blockedReason
          }
          onToggle={() => {
            // `item.occurrenceDate` (the SERIES date), never `item.date`: a
            // moved occurrence is still ticked under the date the series says it
            // belongs to. `done` is sent explicitly so the write matches exactly
            // what the person saw when they tapped.
            toggle.mutate({ task, date: item.occurrenceDate, personId, done: !circleDone });
          }}
        />
      }
    >
      <ItemMain>
        <ItemTitle className={rowDone || skipped ? "text-muted-foreground" : undefined}>
          <span className={cn("min-w-0 truncate", (rowDone || skipped) && "line-through")}>
            {task.name}
          </span>
          {/* "1/3" for a chore everybody owes their own tick on - the circle can
              only ever answer for one person, so the count is what says whether
              the thing as a whole is finished. */}
          {progress ? (
            <Pill tone={progress.done === progress.total ? "pos" : "muted"}>
              {progress.done}/{progress.total}
            </Pill>
          ) : null}
          {skipped ? <Pill tone="muted">preskočeno</Pill> : null}
          {missed && !skipped ? <Pill tone="neg">propušteno</Pill> : null}
          {/* One overdue row stands for every unresolved instance of its series,
              so it has to say how many. "propušteno", not "kasni": the number
              counts missed OCCURRENCES, and "kasni 3" beside a date reads as
              three DAYS - which it only ever is by coincidence, and never for a
              weekly chore. Not shown at 1: the row already carries that one
              instance's date in its meta line. */}
          {item.lateCount && item.lateCount > 1 ? (
            <Pill tone="neg">
              {item.lateCount} {pluralSr(item.lateCount, "propušten", "propuštena", "propuštenih")}
            </Pill>
          ) : null}
        </ItemTitle>
        {meta.length > 0 || item.assigneeIds.length > 0 ? (
          <ItemMeta>
            {meta.length > 0 ? <span className="min-w-0 truncate">{meta.join(" · ")}</span> : null}
            {item.assigneeIds.length > 0 ? (
              <MemberBadges personIds={item.assigneeIds} size="xs" />
            ) : null}
          </ItemMeta>
        ) : null}
      </ItemMain>
      {showTime && item.dueTime ? (
        <ItemSide>
          <ItemTime>{item.dueTime}</ItemTime>
        </ItemSide>
      ) : null}
    </ItemCard>
  );
}

/**
 * What this row's circle owns and what the row as a whole says.
 *
 * `per_assignee` is the case that needs two answers rather than one: the circle
 * can only ever speak for ONE person, so it carries the viewer's own copy (or
 * the whole thing, greyed, for somebody who is not on it), while `rowDone` and
 * the "1/3" pill speak for the chore. Ticking your own part must not strike the
 * title, or a chore three people owe reads as finished the moment the first of
 * them is done.
 */
function useTaskCompletionSlot(item: TaskAgendaItem): {
  personId: string | null;
  /** Filled state of the circle - one person's answer. */
  circleDone: boolean;
  /** Whether the TASK is finished - everybody's answer. Drives strike + dimming. */
  rowDone: boolean;
  canTick: boolean;
  /** Why the circle is dead, for the tap that would otherwise do nothing. */
  blockedReason: string | undefined;
  /** "1/3" when several people each owe their own tick; null otherwise. */
  progress: { done: number; total: number } | null;
} {
  const { profile } = useProfile();
  const { byKey } = useTaskOccurrenceRows();
  const today = useToday().str;
  const viewerId = profile?.id ?? null;

  const slot = taskTickSlot(item.task, item.assigneeIds, viewerId);
  // A repeat that has not come due yet is not something a list circle may
  // finish - see `isFutureOccurrence`. The circle stays visible and disabled;
  // hiding it would read as "this can never be done". The detail sheet is the
  // deliberate way through, for the rare "I did it in advance".
  const notYetDue = isFutureOccurrence(item.task, item.date, today);
  const progress =
    item.task.completion_mode === "per_assignee" && item.assigneeIds.length > 1
      ? assigneeProgress(item.task, item.assigneeIds, item.occurrenceDate, byKey)
      : null;
  const allDone = progress ? progress.done === progress.total : null;

  const own =
    slot.personId === null
      ? (allDone ?? item.isDone)
      : isTaskDoneOn(item.task, item.occurrenceDate, byKey, slot.personId);

  return {
    personId: slot.personId,
    circleDone: own,
    rowDone: allDone ?? own,
    canTick: slot.canTick && !notYetDue,
    // The date rule first: it is the one that applies to a person who IS an
    // assignee and would otherwise be told the chore is not theirs.
    blockedReason: notYetDue
      ? `Još nije na redu - može se završiti ${formatDate(item.date)}.`
      : slot.canTick
        ? undefined
        : "Ovo mogu da završe samo oni kojima je zadatak dodeljen.",
    progress,
  };
}

/**
 * The parent list's name, for a row shown outside that list.
 *
 * Reads the shared lists-with-tasks cache - the same query the /tasks screens
 * live on, so it is usually warm and every row on a screen observes the one
 * copy. `null` while it is still loading, which simply leaves the name out of
 * the meta line rather than reserving space for it.
 */
function useTaskListName(listId: string | null): string | null {
  const { data } = useListsWithTasks();
  if (!listId) return null;
  return data?.find((list) => list.id === listId)?.name ?? null;
}
