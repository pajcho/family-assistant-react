import { CheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";

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
 *
 * A disabled circle owes an explanation. It used to be drawn exactly like a live
 * one and simply swallow the tap, so "why can I not tick this" had no answer
 * anywhere on the screen - and the two reasons a circle is dead (the day has not
 * come yet, the chore is somebody else's) are not guessable. So it now LOOKS
 * inert, wears a padlock, and says the reason when tapped. The tap still lands:
 * a disabled `<input>` swallows its own events, but the `<label>` around it does
 * not, which is what `onBlocked` hangs off.
 */
export function TaskCheckCircle({
  done,
  name,
  onToggle,
  /** Tighter padding for the denser rows inside a list. */
  dense = false,
  disabled = false,
  disabledReason,
}: {
  done: boolean;
  /** Only for the aria label - the visible name lives in the row beside this. */
  name: string;
  onToggle: () => void;
  dense?: boolean;
  disabled?: boolean;
  /** Why this circle is dead. Shown on tap, and read out as the aria label. */
  disabledReason?: string;
}) {
  const blocked = disabled && !!disabledReason;
  return (
    <label
      className={cn(
        // `relative` is load-bearing. The checkbox below is `sr-only`, which
        // is `position: absolute`; without a positioned ancestor here its
        // containing block became the app's screen area, ABOVE the scroll
        // container. The input then escaped that container's clipping and sat
        // at its static position in the frame's coordinate space - so a list of
        // twenty rows left inputs hundreds of pixels below the fold, the frame
        // itself became scrollable, and focusing one on a tap made the browser
        // scroll the WHOLE APP up to reveal it. With this, the input belongs to
        // its own row and is clipped and scrolled like everything else.
        "group/tick relative flex shrink-0 items-center self-stretch",
        dense
          ? "py-3 pl-3 pr-3.5 pointer-fine:py-1.5 pointer-fine:pl-2"
          : "py-3 pl-[13px] pr-[11px]",
        disabled ? "cursor-default" : "cursor-pointer",
      )}
      // Says what the tap DOES; the row beside it says what the task is. When it
      // does nothing, it says that instead - a screen reader gets the same
      // answer the toast gives a thumb.
      aria-label={
        blocked
          ? `„${name}": ${disabledReason}`
          : done
            ? `Vrati „${name}" u aktivne`
            : `Označi „${name}" kao završeno`
      }
    >
      {/* `aria-disabled` rather than `disabled` while there is a reason to give:
          a truly disabled control is unfocusable and fires no events, so it can
          neither be reached by a keyboard nor explain itself to anybody. This
          way the tap and the space bar both land, and both get the answer. The
          input is controlled, so the tick never actually flips. */}
      <input
        type="checkbox"
        checked={done}
        disabled={disabled && !blocked}
        aria-disabled={blocked || undefined}
        onChange={blocked ? () => toast(disabledReason) : onToggle}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[26px] place-items-center rounded-full transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card",
          done ? "border-2 border-task bg-task text-card" : "text-transparent",
          // Dashed and paler, so a locked day reads as locked from across the
          // row rather than only after a tap that does nothing.
          !done && blocked
            ? "border border-dashed border-muted-foreground/40 text-muted-foreground/70"
            : !done && "border-2 border-muted-foreground/45",
          !done && !disabled && "group-hover/tick:border-task",
        )}
      >
        {blocked && !done ? (
          <LockClosedIcon className="size-3" strokeWidth={2} />
        ) : (
          <CheckIcon className="size-4" strokeWidth={3} />
        )}
      </span>
    </label>
  );
}
