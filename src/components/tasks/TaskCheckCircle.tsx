import { CheckIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * The completion circle - the one control that finishes a task, wherever the task
 * is drawn.
 *
 * It lives in its own file because a task now appears on four surfaces (the
 * agenda row, a list, a smart list, the kid shell) and giving any of them its own
 * control is how a square checkbox on one screen ends up meaning the same thing
 * as a circle on the next. One definition, one shape, one aria label.
 *
 * A visually-hidden checkbox inside a generously padded `<label>` makes the whole
 * padded area the tap target while the keyboard still gets a real checkbox, with
 * the focus ring drawn on the circle. The label is always a SIBLING of the row's
 * own button, never a child: nesting one interactive element in another is
 * invalid markup and the outer one swallows the inner one's clicks.
 *
 * No pending state on purpose - `useToggleTask` is optimistic in both of its
 * shapes, so the circle has already flipped by the time a spinner could appear,
 * and the spinner would only fight it.
 */
export function TaskCheckCircle({
  done,
  name,
  onToggle,
  /** Tighter padding for the denser rows inside a list. */
  dense = false,
  disabled = false,
}: {
  done: boolean;
  /** Only for the aria label - the visible name lives in the row beside this. */
  name: string;
  onToggle: () => void;
  dense?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "group/tick flex shrink-0 items-center self-stretch",
        dense
          ? "py-3 pl-3 pr-3.5 pointer-fine:py-1.5 pointer-fine:pl-2"
          : "py-3 pl-[13px] pr-[11px]",
        disabled ? "cursor-default" : "cursor-pointer",
      )}
      // Says what the tap DOES; the row beside it says what the task is.
      aria-label={done ? `Vrati „${name}" u aktivne` : `Označi „${name}" kao završeno`}
    >
      <input
        type="checkbox"
        checked={done}
        disabled={disabled}
        onChange={onToggle}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[26px] place-items-center rounded-full border-2 transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card",
          done ? "border-task bg-task text-card" : "border-muted-foreground/45 text-transparent",
          !done && !disabled && "group-hover/tick:border-task",
        )}
      >
        <CheckIcon className="size-4" strokeWidth={3} />
      </span>
    </label>
  );
}
