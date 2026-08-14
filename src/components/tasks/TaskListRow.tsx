import { Bars3Icon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

import { Button } from "@/components/ui/button";
import { Linkify } from "@/components/common/Linkify";
import { MemberBadges } from "@/components/common/MemberBadges";
import { previewLine } from "@/components/common/MarkdownText";
import { Pill } from "@/components/common/Pill";
import { TaskCheckCircle } from "@/components/tasks/TaskCheckCircle";
import { cn } from "@/lib/cn";
import type { Task } from "@/types/database";

/**
 * Bindings forwarded from `useSortable` so this row can host a drag
 * handle. Only the listeners/attributes for the handle button are
 * needed - the row's outer ref + transform are applied by the parent
 * `SortableRow` wrapper.
 */
export type DragHandleBindings = {
  listeners: SyntheticListenerMap | undefined;
  attributes: DraggableAttributes;
};

export type TaskListRowProps = {
  item: Task;
  /**
   * Resolved completion for THIS row. Never `item.is_completed` directly: a
   * recurring task is structurally forbidden from carrying its own boolean, so
   * the body resolves it through `isTaskDoneOn` for the instance the row stands
   * for and hands the answer down.
   */
  done: boolean;
  onToggle: (item: Task) => void;
  /** Open the full edit/view dialog for this task. */
  onOpen: (item: Task) => void;
  onDelete: (item: Task) => void;
  /**
   * Second line, built by the body: the recurrence phrase, a due-date chip, the
   * clock. Kept out of here so the same row can say "4. avg" inside a list and
   * nothing at all in a shopping list that has no dates.
   */
  meta?: string | null;
  /** Late-tone chip after the title (a due date that already passed). */
  duePill?: { label: string; late: boolean } | null;
  /** Whose chore it is - the member badges after the meta line. */
  assigneeIds?: string[];
  /**
   * False when this viewer was not given the task and so may not finish it -
   * see `taskTickSlot`. The circle stays, greyed, so the row still reads as
   * a task rather than as a note.
   */
  canTick?: boolean;
  /**
   * Why the circle is dead. Without it a tap on a locked circle does nothing at
   * all and the row never says why - which is the whole complaint the lock
   * treatment answers.
   */
  blockedReason?: string;
  /**
   * "1/3" for a chore everybody owes their own tick on. The circle can only ever
   * answer for one person, so the count is what says whether the thing as a
   * whole is finished.
   */
  progress?: { done: number; total: number } | null;
  /** Trailing clock for a timed task ("09:00"). */
  timeLabel?: string | null;
  /**
   * When provided, the row renders a drag handle on its right side and
   * forwards the dnd-kit listeners onto that button. Omit to render a
   * non-draggable row (grouped views, completed tasks).
   */
  dragHandle?: DragHandleBindings;
};

/**
 * One row inside a list - tick box + name (+ meta) + (desktop-only)
 * edit/delete icons.
 *
 * Returns a `<div>` rather than `<li>`; the parent owns the list element so
 * it can also wrap the row in a swipe-gesture container without nesting
 * invalid `<ul><div><li>` markup.
 *
 * Click behaviour
 *   • Checkbox area  → toggle completion (label proxy makes a generous
 *                      tap target on phones)
 *   • Text area      → open the edit dialog
 *   • Pencil button  → same as text area, kept for the desktop mouse-over
 *                      shortcut
 *   • Trash button   → request delete (handled by parent confirm dialog)
 *
 * Touch devices (`pointer: coarse`): inline edit/delete buttons are
 * hidden; the user reaches the same actions via tap-to-open and the
 * swipe gestures handled by `SwipeableTaskRow`.
 *
 * Mouse devices (`pointer: fine`): the icons fade in on hover / focus-within
 * so the row stays clean by default and reveals the actions when the user
 * reaches it. We gate on pointer type rather than viewport width so a
 * touchscreen tablet with a 1024px viewport still gets the touch UX, and
 * a desktop with a narrow window still gets the buttons.
 */
export function TaskListRow({
  item,
  done,
  onToggle,
  onOpen,
  onDelete,
  meta,
  duePill,
  assigneeIds,
  canTick = true,
  blockedReason,
  progress = null,
  timeLabel,
  dragHandle,
}: TaskListRowProps) {
  // Reduce the (possibly multi-line, possibly Markdown) description to a
  // single trimmed line for the row preview. Empty after stripping ⇒ no
  // preview row, which keeps the gap between checkbox + label tight.
  const descriptionPreview = previewLine(item.description);
  // `done` is ONE person's answer (the circle); the strike and the dimming belong
  // to the whole chore, which for a per-person one is the count.
  const allDone = progress ? progress.done === progress.total : done;
  const secondLine = [meta, descriptionPreview].filter(Boolean).join(" · ");
  const hasBadges = (assigneeIds?.length ?? 0) > 0;

  return (
    <div className="group flex items-stretch rounded-md bg-card transition-colors hover:bg-muted/60">
      {/* The SAME circle the agenda row and the kid card use. A square checkbox
          here and a circle there would be two controls for one concept, on rows
          that hold the very same task. */}
      <TaskCheckCircle
        done={done}
        name={item.name}
        onToggle={() => onToggle(item)}
        disabled={!canTick}
        disabledReason={blockedReason}
        dense
      />
      {/* Hit-target scoping: the wrapper owns the flex-1 stretch (with inert
          right padding) while the button shrinks to text width so only the
          visible label area is a tap target. `items-stretch` lets the button
          still fill the row vertically so the area above/below the text
          remains forgiving. */}
      <div className="flex min-w-0 flex-1 items-stretch pr-3 pointer-fine:pr-2">
        {/* role="button" rather than a real <button>: the title may contain
            autolinked URLs (<a> elements), which HTML forbids nesting inside
            a <button>. We re-add the button keyboard contract (Enter/Space)
            and gate it on the row itself so key presses on a focused inner
            link aren't hijacked into opening the dialog. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(item)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(item);
            }
          }}
          className={cn(
            "flex max-w-full min-w-0 cursor-pointer flex-col justify-center rounded-sm py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-fine:py-1.5",
            allDone ? "text-muted-foreground" : "text-foreground",
          )}
          aria-label={`Otvori detalje za „${item.name}"`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("min-w-0 truncate", allDone && "line-through")}>
              <Linkify
                text={item.name}
                linkClassName={cn(
                  "underline underline-offset-2",
                  done ? "text-muted-foreground" : "text-accent-deep",
                )}
              />
            </span>
            {progress ? (
              <Pill tone={progress.done === progress.total ? "pos" : "muted"}>
                {progress.done}/{progress.total}
              </Pill>
            ) : null}
            {duePill ? <Pill tone={duePill.late ? "neg" : "muted"}>{duePill.label}</Pill> : null}
          </span>
          {secondLine || hasBadges ? (
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-xs",
                done ? "text-muted-foreground/60" : "text-muted-foreground",
              )}
            >
              {secondLine ? <span className="min-w-0 truncate">{secondLine}</span> : null}
              {hasBadges ? <MemberBadges personIds={assigneeIds ?? []} size="xs" /> : null}
            </span>
          ) : null}
        </div>
      </div>
      {timeLabel ? (
        <div className="flex shrink-0 items-center pr-2 text-xs font-normal text-muted-foreground tabular-nums">
          {timeLabel}
        </div>
      ) : null}
      {/* Inline action buttons - mouse-only. Touch users get the same
          operations via tap-to-open + swipe gestures, so the icons would
          just be visual noise. The `pointer-fine` variant is defined in
          src/styles/index.css and maps to `@media (pointer: fine)`. */}
      <div className="hidden shrink-0 items-center gap-0.5 pr-1 pointer-fine:flex pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onOpen(item)}
          aria-label="Izmeni zadatak"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onDelete(item)}
          aria-label="Obriši zadatak"
        >
          <TrashIcon className="h-3.5 w-3.5 text-neg" />
        </Button>
      </div>
      {/* Drag handle - only rendered when the list is reorderable
          (manual grouping + active section). Lives in its own slot so it
          stays visible on touch devices where the pencil/trash buttons
          are hidden; on desktop it joins the hover/focus reveal so the
          row stays clean by default. The listeners come from the parent
          `SortableActiveRow`'s `useSortable()` call - attaching them only to
          the handle button (not the row body) keeps tap-to-open, swipe
          gestures, and the checkbox label all working untouched. */}
      {dragHandle ? (
        <div className="flex shrink-0 items-center pr-2 pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
          <button
            type="button"
            aria-label={`Premesti „${item.name}"`}
            className="flex h-9 w-9 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
            // Stop the pointerdown from reaching `SwipeableTaskRow`, which
            // is the row's outer `<li>` on touch devices and would
            // otherwise see the drag's pointer-move stream as a possible
            // horizontal swipe. dnd-kit's own handler still fires because
            // we re-invoke it after stopping propagation.
            onPointerDown={(e) => {
              e.stopPropagation();
              dragHandle.listeners?.onPointerDown?.(e);
            }}
          >
            <Bars3Icon className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
