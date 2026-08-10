import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * The back-to-now pill - shared by every time navigator (the time strips of
 * redesign 2.0): Money and the month view jump back to the current month, the
 * week strips to today / this week. It renders ONLY while the user has drifted
 * away from "now", so the chrome stays clean at rest - which is why it carries
 * no "hidden" state of its own.
 *
 * Visually a 28px pill, but the touch target is enlarged with a transparent
 * pseudo-element (the same trick as FilterChip) so a finger need not aim.
 */
export function NowPill({
  label,
  onClick,
  className,
  "aria-label": ariaLabel,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={cn(
        "relative flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5",
        "border border-accent/30 bg-accent-soft text-xs font-semibold whitespace-nowrap text-accent-deep",
        "transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <ArrowUturnLeftIcon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}
