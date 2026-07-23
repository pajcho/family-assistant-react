import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

import {
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";

/**
 * The app-wide "sub-modal" convention: a detail sheet NEVER opens a second
 * overlay on top of itself. Drilling in (options menu, history, reschedule,
 * confirm…) pushes a view onto this stack and the sheet swaps its content in
 * place - one overlay, arbitrarily deep. Every non-root view shows a "←"
 * back arrow in its header ({@link SheetStackHeader}).
 *
 * Dismissing a sub-view (swipe-down, tap outside, Escape) goes BACK one level
 * instead of closing the whole flow:
 *   - desktop Dialog: the dismissal is swallowed and the stack pops in place;
 *   - mobile Drawer: the close is accepted (vaul has already committed to the
 *     exit - refusing it strands the drag transform), and the sheet reopens
 *     one level up after a short beat: the sub-view drops away and the
 *     previous view immediately rises back, without waiting out the full
 *     exit + enter animations back to back.
 * Only a dismissal at the root actually closes the sheet. Success handlers
 * that should tear down the whole flow keep calling the owner's
 * `onOpenChange(false)` directly.
 */

/**
 * How long the dismissed drawer keeps its exit animation before the sheet
 * remounts one level up. vaul's exit runs 500ms on a fast-start curve, so by
 * ~200ms a dismissed drawer has visually dropped; waiting the full exit (and
 * only then playing a full enter) reads as a laggy pause between views.
 */
const REOPEN_DELAY_MS = 200;

export type SheetStack<V> = {
  /** The view currently on top of the stack. */
  view: V;
  atRoot: boolean;
  push: (view: V) => void;
  /** Go back one level (no-op at the root). */
  pop: () => void;
  /** Clear back to the root view (e.g. when the subject entity changes). */
  reset: () => void;
  /** Feed this to <ResponsiveDialog open> - false while the mobile close→reopen hop runs. */
  dialogOpen: boolean;
  /**
   * Feed this to <ResponsiveDialog key> - bumped on every mobile close→reopen
   * hop so the drawer remounts fresh. Without it vaul reopens the SAME node
   * with the dismissal drag's translate still inlined and the sheet hangs
   * half-off-screen.
   */
  dialogKey: number;
  /** Feed this to <ResponsiveDialog onOpenChange> - routes dismissals through the stack. */
  handleOpenChange: (next: boolean) => void;
};

export function useSheetStack<V>(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  root: V,
): SheetStack<V> {
  const isDesktop = useIsDesktop();
  const [stack, setStack] = useState<V[]>([root]);
  const [suspended, setSuspended] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const reopenTimer = useRef<number | null>(null);
  // Roots are often object literals recreated per render - keep the latest in
  // a ref so reset/effects never loop on identity.
  const rootRef = useRef(root);
  rootRef.current = root;

  const clearReopenTimer = () => {
    if (reopenTimer.current != null) {
      window.clearTimeout(reopenTimer.current);
      reopenTimer.current = null;
    }
  };

  // The owner closed (or unmounted the subject) - next open starts at the
  // root. Bail out (keep state identity) when there's nothing to reset: a
  // needless re-render here lands exactly while the drawer's exit animation
  // is starting, and interrupting that leaves Radix waiting on an
  // `animationend` that never fires (a ghost half-open drawer).
  useEffect(() => {
    if (!open) {
      clearReopenTimer();
      setStack((s) => (s.length > 1 ? [rootRef.current] : s));
      setSuspended((s) => (s ? false : s));
    }
  }, [open]);
  useEffect(() => clearReopenTimer, []);

  const view = stack.length > 0 ? stack[stack.length - 1] : rootRef.current;
  const atRoot = stack.length <= 1;

  const push = useCallback((v: V) => {
    setStack((s) => [...s, v]);
  }, []);
  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  // Same bail-out as above: `reset()` runs from subject-change effects on
  // every render cycle where the entity flips (including to null on close) -
  // it must not schedule re-renders when the stack is already at the root.
  const reset = useCallback(() => {
    setStack((s) => (s.length > 1 ? [rootRef.current] : s));
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (stack.length > 1) {
      if (isDesktop) {
        // Radix Dialog in controlled mode simply stays open when we don't
        // flip the prop - swap the content in place.
        pop();
        return;
      }
      // Mobile: let the dismissed drawer start dropping, then quickly bring
      // the previous level back up.
      setSuspended(true);
      clearReopenTimer();
      reopenTimer.current = window.setTimeout(() => {
        reopenTimer.current = null;
        setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
        setEpoch((e) => e + 1);
        setSuspended(false);
      }, REOPEN_DELAY_MS);
      return;
    }
    onOpenChange(false);
  };

  return {
    view,
    atRoot,
    push,
    pop,
    reset,
    dialogOpen: open && !suspended,
    dialogKey: epoch,
    handleOpenChange,
  };
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
            className="-ml-1.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
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
