import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";

import { cn } from "@/lib/cn";
import { memberTintStyle } from "@/utils/memberAvatar";

/**
 * The redesign's list row (prototype `.kcard`): a full-width card with a
 * rounded icon tile, a two-line main column and an optional right-hand column.
 * Every scannable list uses it - the agenda, events, birthdays, activities, the
 * lists index - so a row reads the same wherever it appears.
 *
 * It is a plain layout shell: `ItemCard` (button or static), `ItemTile` (the
 * `.sq` glyph tile), `ItemTitle` / `ItemMeta` for the main column and
 * `ItemSide` for the trailing one. Callers own the content, including which
 * semantic tone the tile gets.
 */

const CARD_BASE =
  "flex w-full items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3 text-left " +
  "text-card-foreground shadow-card transition-transform";

export function ItemCard({
  onClick,
  disabled,
  dimmed = false,
  className,
  ariaLabel,
  children,
}: {
  /** Omit for a read-only row (upcoming payment occurrences, span notes). */
  onClick?: () => void;
  disabled?: boolean;
  /** Past / paused / not-yet-actionable rows fade back. */
  dimmed?: boolean;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const classes = cn(CARD_BASE, dimmed && "opacity-55", className);

  if (!onClick) {
    return <div className={classes}>{children}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        classes,
        "active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "motion-reduce:active:scale-100",
      )}
    >
      {children}
    </button>
  );
}

export type ItemTileTone = "accent" | "pos" | "warn" | "neg" | "info" | "task" | "muted";

const TILE_TONE: Record<ItemTileTone, string> = {
  accent: "bg-accent-soft text-accent-deep",
  pos: "bg-pos-soft text-pos",
  warn: "bg-warn-soft text-warn",
  neg: "bg-neg-soft text-neg",
  info: "bg-info-soft text-info",
  // Tasks own a violet of their own; see the note on `--task` in styles.
  task: "bg-task-soft text-task",
  muted: "bg-muted text-muted-foreground",
};

/**
 * `.sq` - the 42px glyph tile. Pass `color` (a family member's hex) to tint it
 * with that person instead of a semantic tone; the fill is mixed against the
 * card so it stays legible in both themes.
 */
export function ItemTile({
  icon: Icon,
  tone = "accent",
  color,
  className,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: ItemTileTone;
  color?: string;
  className?: string;
}) {
  const style: CSSProperties | undefined = color
    ? { backgroundColor: `color-mix(in srgb, ${color} 14%, var(--card))`, color }
    : undefined;

  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "grid size-[42px] shrink-0 place-items-center rounded-lg",
        !color && TILE_TONE[tone],
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** Main column - grows, truncates, stacks title over meta. */
export function ItemMain({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("flex min-w-0 flex-1 flex-col gap-[2.5px]", className)}>{children}</span>
  );
}

export function ItemTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-[15px] leading-[1.25] font-semibold tracking-[-0.01em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ItemMeta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-[1.35] font-normal text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Trailing column - time, amount, status pill, chevron. */
export function ItemSide({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("flex shrink-0 flex-col items-end gap-1 text-right", className)}>
      {children}
    </span>
  );
}

/** `.ktime` - the bold tabular clock in the trailing column. */
export function ItemTime({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("text-[14.5px] font-bold tabular-nums", className)}>{children}</span>;
}

/**
 * "This row belongs to that person" - a 7px chip of their colour beside the
 * title, or their emoji when the viewer reads members as emoji (see
 * `useMemberEmoji`). Decorative either way: every row that carries one also
 * spells the name out in its meta line.
 *
 * The emoji always sits in a tinted circle, the same one `MemberAvatar` draws
 * at `xs`. A bare glyph beside a title reads as part of the title ("Teretana
 * 🦁") rather than as a person mark, and it made the app inconsistent with
 * itself: the very same person appeared circled on a payment row and bare on
 * the activity row above it. The circle also keeps the member's colour on
 * screen, which is what ties this row to that person's blocks in the weekly
 * grid.
 */
export function PersonDot({
  color,
  emoji,
  className,
}: {
  color: string;
  emoji?: string;
  className?: string;
}) {
  if (emoji) {
    return (
      <span
        aria-hidden="true"
        style={memberTintStyle(color)}
        className={cn(
          // `inline-flex`, not `flex`: these ride inside running text as often
          // as inside a flex row, and a flex item blockifies it anyway.
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] align-middle text-[13px] leading-none",
          className,
        )}
      >
        {emoji}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className={cn("inline-block size-[7px] shrink-0 rounded-full", className)}
    />
  );
}
