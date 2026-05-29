import * as React from "react";
import { CheckIcon, TrashIcon } from "@heroicons/react/24/outline";

/**
 * Swipe-to-action wrapper for one list row.
 *
 *   ◀ swipe-left  — onSwipeLeft (delete; parent shows a confirm)
 *   swipe-right ▶ — onSwipeRight (toggle complete)
 *
 * Only active on touch-primary devices. We gate on `(pointer: coarse)`
 * rather than a viewport width: a desktop user with a narrow window is
 * still using a mouse and shouldn't lose the inline edit/delete buttons
 * to gestures they can't easily perform. On `pointer: fine` devices the
 * wrapper renders a plain <li> with no pointer handlers and no reveal
 * layers — equivalent to "swipe disabled".
 *
 * Implementation notes
 * --------------------
 * • Pointer events (not touch events) so the same code path works on
 *   touch, stylus, and (for the unusual touchscreen-laptop case) mouse.
 * • Direction lock: we wait until the user has moved more than
 *   `DIRECTION_LOCK_PX` and then decide whether this gesture is a horizontal
 *   swipe or a vertical scroll. If horizontal, we `setPointerCapture` and
 *   start translating. If vertical, we never preventDefault and the page
 *   keeps scrolling normally.
 * • Tap-suppression: any meaningful horizontal movement flips a ref. The
 *   wrapper installs an `onClickCapture` that swallows the synthetic click
 *   that would otherwise fire after pointerup — so swiping doesn't also
 *   open the inline-edit input or toggle the checkbox.
 * • Snap-back animation: when the gesture doesn't reach the action
 *   threshold (or while idle) the foreground transitions back to dx=0
 *   over 200ms. We disable that transition mid-drag so the row follows
 *   the finger 1:1.
 */

const DIRECTION_LOCK_PX = 8;
const TAP_BREAKOUT_PX = 6;
const ACTION_THRESHOLD_PX = 80;

/**
 * Returns true on phones and tablets where touch is the primary input.
 * Subscribes to media-query changes so the answer updates if the user
 * docks/undocks a hybrid device (e.g. attaches a keyboard cover).
 */
function useHasCoarsePointer(): boolean {
  // Default to `false` (desktop / mouse) so SSR and the first render before
  // matchMedia resolves both behave like desktop. The effect flips us to
  // touch mode on the next tick if appropriate.
  const [coarse, setCoarse] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return coarse;
}

export type SwipeableListItemProps = {
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  /** Disable gestures (e.g. when the row is in edit mode). */
  disabled?: boolean;
  children: React.ReactNode;
};

type Direction = "horizontal" | "vertical" | null;

export function SwipeableListItem({
  onSwipeRight,
  onSwipeLeft,
  disabled = false,
  children,
}: SwipeableListItemProps) {
  const isTouchDevice = useHasCoarsePointer();

  // Desktop / mouse: pass through as a plain row — no gestures, no reveal
  // layers, no click-suppression. The inline edit/delete buttons in
  // `ListItemRow` already cover the same operations on hover.
  if (!isTouchDevice || disabled) {
    return <li className="rounded-md">{children}</li>;
  }

  // Render the gesture-enabled implementation below.
  return (
    <SwipeableImpl onSwipeRight={onSwipeRight} onSwipeLeft={onSwipeLeft}>
      {children}
    </SwipeableImpl>
  );
}

type SwipeableImplProps = Pick<SwipeableListItemProps, "onSwipeRight" | "onSwipeLeft" | "children">;

function SwipeableImpl({ onSwipeRight, onSwipeLeft, children }: SwipeableImplProps) {
  const [dx, setDx] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);

  const startRef = React.useRef<{ x: number; y: number } | null>(null);
  const directionRef = React.useRef<Direction>(null);
  const didSwipeRef = React.useRef(false);

  const reset = React.useCallback(() => {
    startRef.current = null;
    directionRef.current = null;
    setDx(0);
    setDragging(false);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLLIElement>) => {
    // Only the primary pointer (first finger / left mouse). Secondary
    // pointers (multi-touch zoom etc.) shouldn't initiate a swipe.
    if (!e.isPrimary) return;

    startRef.current = { x: e.clientX, y: e.clientY };
    directionRef.current = null;
    didSwipeRef.current = false;
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
    if (!dragging || !startRef.current) return;

    const deltaX = e.clientX - startRef.current.x;
    const deltaY = e.clientY - startRef.current.y;

    if (directionRef.current === null) {
      if (Math.abs(deltaX) < DIRECTION_LOCK_PX && Math.abs(deltaY) < DIRECTION_LOCK_PX) {
        return; // still inside the dead zone
      }
      directionRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      if (directionRef.current === "horizontal") {
        // Take ownership of subsequent events so leaving the original
        // <li> bounds during the drag doesn't cancel the gesture.
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }

    if (directionRef.current === "horizontal") {
      // Cancel the native click that would otherwise fire on pointerup
      // (the tap-suppression layer reads this).
      if (Math.abs(deltaX) > TAP_BREAKOUT_PX) didSwipeRef.current = true;
      setDx(deltaX);
    }
  };

  const handlePointerUp = (_e: React.PointerEvent<HTMLLIElement>) => {
    if (!dragging) return;

    if (directionRef.current === "horizontal") {
      if (dx > ACTION_THRESHOLD_PX) {
        onSwipeRight();
      } else if (dx < -ACTION_THRESHOLD_PX) {
        onSwipeLeft();
      }
    }
    reset();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    // Suppress the trailing click only when the user actually swiped — a
    // pure tap (no horizontal movement past TAP_BREAKOUT_PX) must still
    // reach the underlying button / checkbox.
    if (didSwipeRef.current) {
      e.preventDefault();
      e.stopPropagation();
      // Cleared by the next pointerdown.
    }
  };

  // Show the reveal layers only when we're committed to a horizontal gesture
  // so a vertical scroll doesn't briefly flash green/red behind the row.
  const isHorizontal = directionRef.current === "horizontal";
  const showLeftReveal = isHorizontal && dx > 0;
  const showRightReveal = isHorizontal && dx < 0;
  // Opacity ramps from 0 to 1 as the user crosses the action threshold so
  // it's obvious when releasing will actually trigger the action.
  const leftOpacity = Math.min(1, Math.abs(dx) / ACTION_THRESHOLD_PX);
  const rightOpacity = Math.min(1, Math.abs(dx) / ACTION_THRESHOLD_PX);

  return (
    <li
      className="relative overflow-hidden rounded-md"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        reset();
      }}
      onClickCapture={handleClickCapture}
      // touch-pan-y lets the page still scroll vertically through the row
      // (we only block native panning if we lock to horizontal).
      style={{ touchAction: "pan-y" }}
    >
      {/* Reveal under-layers — pointer-events:none so they never intercept
          the swipe. The colored band grows from the edge inward as the row
          slides over it. */}
      {showLeftReveal ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-start gap-2 bg-emerald-500 px-4 text-white"
          style={{ width: Math.max(0, dx), opacity: leftOpacity }}
        >
          <CheckIcon className="h-5 w-5" />
        </div>
      ) : null}
      {showRightReveal ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end gap-2 bg-red-500 px-4 text-white"
          style={{ width: Math.max(0, -dx), opacity: rightOpacity }}
        >
          <TrashIcon className="h-5 w-5" />
        </div>
      ) : null}

      {/* Foreground — the actual row. Translates with the gesture; snaps
          back via CSS transition when we reset dx to 0. */}
      <div
        className="relative"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 200ms ease-out",
        }}
      >
        {children}
      </div>
    </li>
  );
}
