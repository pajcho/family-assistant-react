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
import { isTaskDoneOn, taskRecurrenceLabel } from "@/utils/task";

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
  const { personId, done } = useTaskCompletionSlot(item);
  const listName = useTaskListName(showListName ? task.list_id : null);

  // A done row is never also "propušteno": it was resolved, just late.
  const missed = item.missed && !done;
  const meta = [taskRecurrenceLabel(task), listName, dateLabel ? `rok ${dateLabel}` : null].filter(
    Boolean,
  );

  return (
    <ItemCard
      onClick={onClick}
      dimmed={done}
      ariaLabel={`Otvori detalje za „${task.name}"`}
      leading={
        <TaskCheckCircle
          done={done}
          name={task.name}
          onToggle={() => {
            // `item.occurrenceDate` (the SERIES date), never `item.date`: a
            // moved occurrence is still ticked under the date the series says it
            // belongs to. `done` is sent explicitly so the write matches exactly
            // what the person saw when they tapped.
            toggle.mutate({ task, date: item.occurrenceDate, personId, done: !done });
          }}
        />
      }
    >
      <ItemMain>
        <ItemTitle className={done ? "text-muted-foreground" : undefined}>
          <span className={cn("min-w-0 truncate", done && "line-through")}>{task.name}</span>
          {missed ? <Pill tone="neg">propušteno</Pill> : null}
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
 * Which occurrence slot this row's circle owns, and whether it reads as done.
 *
 * `completion_mode: 'shared'` has ONE answer for the whole occurrence and
 * `item.isDone` already carries it. `'per_assignee'` has as many answers as the
 * task has assignees, so a single circle has to pick one:
 *
 *   - the viewer's own copy when the viewer is an assignee;
 *   - otherwise, when the chore has exactly ONE assignee, that person's - the
 *     everyday case of a child's chore ticked off by a parent from Danas;
 *   - otherwise the viewer's own, matching `useToggleTask`'s default.
 *
 * The delegation stays auditable either way: `completed_by_person_id` records
 * who actually tapped, not whose slot was filled.
 */
function useTaskCompletionSlot(item: TaskAgendaItem): { personId: string | null; done: boolean } {
  const { profile } = useProfile();
  const { byKey } = useTaskOccurrenceRows();
  const viewerId = profile?.id ?? null;

  if (item.task.completion_mode !== "per_assignee") {
    return { personId: null, done: item.isDone };
  }

  const personId =
    viewerId && item.assigneeIds.includes(viewerId)
      ? viewerId
      : item.assigneeIds.length === 1
        ? item.assigneeIds[0]
        : viewerId;
  return { personId, done: isTaskDoneOn(item.task, item.occurrenceDate, byKey, personId) };
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
