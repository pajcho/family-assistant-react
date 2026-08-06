import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";

import { useEdgeFade } from "@/hooks/useEdgeFade";
import { cn } from "@/lib/cn";

/**
 * Horizontally scrolling filter chip row (prototype `.fchips` / `.fchip`) -
 * the redesign's inline filter surface, replacing the "Filteri" sheet trigger
 * on the screens whose facets fit on one swipeable line.
 *
 * Chips are additive filters, deliberately distinct from `Segmented` (exclusive
 * views): a chip is a pill that fills with the accent when on. The visible pill
 * is ~30px tall like the prototype, but each chip grows its own tap target to
 * 44px with a transparent pseudo-element, so the row stays visually light
 * without shrinking the finger target.
 */

export function FilterChipRow({
  ariaLabel,
  className,
  children,
}: {
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const fadeRef = useEdgeFade<HTMLDivElement>();

  return (
    <div
      ref={fadeRef}
      role="group"
      aria-label={ariaLabel}
      // Exactly the page column's width - no bleed. The row used to hang 16px
      // past it on each side, which read as the filters being wider than the
      // screen. `fade-scroll-x` ramps out whichever end still has chips behind
      // it, so they thin out AT the page edge instead of being cut there.
      className={cn(
        "scrollbar-hide fade-scroll-x flex min-h-11 items-center gap-1.5 overflow-x-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FilterChip({
  active,
  onToggle,
  icon: Icon,
  /** Family-member colour: tints the chip with the person instead of the accent. */
  color,
  className,
  children,
}: {
  active: boolean;
  onToggle: () => void;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  color?: string;
  className?: string;
  children: ReactNode;
}) {
  const style: CSSProperties | undefined =
    color && active
      ? {
          backgroundColor: `color-mix(in srgb, ${color} 16%, var(--card))`,
          borderColor: color,
          color: `color-mix(in srgb, ${color} 72%, var(--foreground))`,
        }
      : undefined;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      style={style}
      className={cn(
        "relative flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5",
        "text-[12.5px] font-semibold whitespace-nowrap transition-colors",
        "after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        color
          ? active
            ? "border"
            : "border-border bg-card text-muted-foreground"
          : active
            ? // Dark theme softens the fill: a saturated accent pill glares
              // against the dark card layer the way it does not on white.
              "border-accent bg-accent text-accent-foreground dark:bg-accent-soft dark:text-foreground"
            : "border-border bg-card text-muted-foreground",
        className,
      )}
    >
      {color ? (
        <span
          aria-hidden="true"
          style={{ backgroundColor: color }}
          className="size-2 shrink-0 rounded-full"
        />
      ) : Icon ? (
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}
