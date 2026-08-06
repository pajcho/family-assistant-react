import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

import {
  ResponsiveDialog,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

/**
 * The app-wide "sub-modal" convention: drilling in from a sheet (options menu,
 * history, reschedule, confirm…) opens a NEW overlay ON TOP of the one you came
 * from, the way the date picker opens over a form. The sheet underneath keeps
 * its scroll position and its state and is simply covered.
 *
 * It used to swap the content of a single overlay in place, which meant the
 * mobile drawer had to be dismissed and re-opened one level up on every "back"
 * (a close → remount → reopen hop). Stacking real overlays removes that dance:
 * a dismissal is just the top layer closing, and the layer below is already
 * there, already rendered.
 *
 * Dismissing a sub-view (swipe-down, tap outside, Escape) goes BACK one level -
 * Radix and Vaul both route the gesture to the topmost layer, so this falls out
 * of the stack rather than being special-cased. Only a dismissal at the root
 * closes the flow. Success handlers that should tear down the whole flow keep
 * calling the owner's `onOpenChange(false)` directly.
 *
 * Levels stay MOUNTED after they are popped, closed rather than removed, so the
 * exit animation plays out; a closed Radix/Vaul overlay renders nothing, so the
 * level's content costs nothing while it sits there. The whole set is reset to
 * the root the next time the flow opens - never while it is closing, which
 * would interrupt an exit animation mid-flight.
 */

export type SheetStack<V> = {
  /** The view on top of the stack - what a shared title/footer switch reads. */
  view: V;
  atRoot: boolean;
  push: (view: V) => void;
  /** Go back one level (no-op at the root). */
  pop: () => void;
  /** Clear back to the root view (e.g. when the subject entity changes). */
  reset: () => void;
  /**
   * Every level that is still mounted, root first. Longer than the open depth
   * while a popped level animates out. Read by {@link SheetStackViews}.
   */
  levels: readonly V[];
  /** How many levels are open. `levels[depth - 1]` is {@link SheetStack.view}. */
  depth: number;
  /** Whether the flow is open at all (the owner's `open`). */
  open: boolean;
  /** Dismissal from a given level: the root closes the flow, deeper ones pop. */
  dismiss: (level: number) => void;
};

export function useSheetStack<V>(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  root: V,
): SheetStack<V> {
  // One piece of state: `levels` can outlive `depth` (a popped level animating
  // out), and the two must never be committed out of step.
  const [state, setState] = useState<{ levels: V[]; depth: number }>(() => ({
    levels: [root],
    depth: 1,
  }));
  const { levels, depth } = state;
  // Roots are often object literals recreated per render - keep the latest in
  // a ref so reset/effects never loop on identity.
  const rootRef = useRef(root);
  rootRef.current = root;

  // Rearm on OPEN, not on close: a closing flow still has drawers playing their
  // exit animation, and pulling their content out from under them leaves Radix
  // waiting on an `animationend` that never fires (a ghost half-open drawer).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) setState({ levels: [rootRef.current], depth: 1 });
    wasOpen.current = open;
  }, [open]);

  const view = levels[depth - 1] ?? rootRef.current;
  const atRoot = depth <= 1;

  const push = useCallback((v: V) => {
    // Drop anything above the current level (a half-exited sibling) and put the
    // new view in its place, so the stack stays a stack.
    setState((s) => ({ levels: [...s.levels.slice(0, s.depth), v], depth: s.depth + 1 }));
  }, []);

  const pop = useCallback(() => {
    setState((s) => (s.depth > 1 ? { ...s, depth: s.depth - 1 } : s));
  }, []);

  // The bail-out matters: `reset()` runs from subject-change effects on every
  // render cycle where the entity flips (including to null on close) - it must
  // not schedule re-renders when the stack is already at the root.
  const reset = useCallback(() => {
    setState((s) => (s.depth > 1 ? { ...s, depth: 1 } : s));
  }, []);

  const dismiss = useCallback(
    (level: number) => {
      if (level > 0) {
        pop();
        return;
      }
      onOpenChange(false);
    },
    [onOpenChange, pop],
  );

  return { view, atRoot, push, pop, reset, levels, depth, open, dismiss };
}

export type SheetStackViewsProps<V> = {
  stack: SheetStack<V>;
  /**
   * Renders ONE level: return its `<ResponsiveDialogContent>`. Called for every
   * mounted level, so branch on the `view` argument (not on `stack.view`) or a
   * covered sheet will show the top one's content.
   */
  render: (view: V, level: number) => ReactNode;
  /**
   * Close every layer without losing the stack - for a flow that temporarily
   * hands the screen to another dialog (an edit form, a linked entity) and
   * expects to come back to exactly where it was.
   */
  hidden?: boolean;
};

/** Renders the stack: one overlay per level, the deepest one on top. */
export function SheetStackViews<V>({ stack, render, hidden = false }: SheetStackViewsProps<V>) {
  return (
    <>
      {stack.levels.map((view, level) => (
        <ResponsiveDialog
          // Keyed by depth, not by view: the overlay instance has to survive a
          // view swap at the same level, or its open/close transition restarts.
          key={level}
          open={stack.open && !hidden && level < stack.depth}
          onOpenChange={(next) => {
            if (!next) stack.dismiss(level);
          }}
        >
          {render(view, level)}
        </ResponsiveDialog>
      ))}
    </>
  );
}

export type SheetStackHeaderProps = {
  title: ReactNode;
  /** Renders the "←" back arrow before the title when provided. */
  onBack?: () => void;
  backAriaLabel?: string;
  description?: ReactNode;
  /**
   * Visually hide the header (detail roots that lead with a hero row instead).
   * The back arrow is never rendered in this state - an invisible but
   * focusable button would trap keyboard users.
   */
  srOnly?: boolean;
};

/** Shared sub-view header: "←" + title, the ActivityOptionsSheet pattern. */
export function SheetStackHeader({
  title,
  onBack,
  backAriaLabel = "Nazad",
  description,
  srOnly = false,
}: SheetStackHeaderProps) {
  return (
    <ResponsiveDialogHeader className={srOnly ? "sr-only" : undefined}>
      <div className="flex items-center gap-1.5">
        {onBack && !srOnly ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backAriaLabel}
            className="-ml-2 grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        ) : null}
        <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
      </div>
      {description ? (
        <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
      ) : null}
    </ResponsiveDialogHeader>
  );
}
