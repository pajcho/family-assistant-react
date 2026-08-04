import type { ComponentType, ReactNode, SVGProps } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * The settings hub's row anatomy, straight from the redesign prototype: a
 * group is one card, rows inside it are separated by hairlines, and each row
 * is `[icon tile] [label + hint] [value / control]`.
 *
 * Kept here rather than in `common/` because it is the Podešavanja idiom -
 * lists and agenda rows are cards in their own right, not rows of a group.
 */

export type SettingsTone = "accent" | "pos" | "warn" | "neg" | "info" | "muted";

const TONE_TILE: Record<SettingsTone, string> = {
  accent: "bg-accent-soft text-accent-deep",
  pos: "bg-pos-soft text-pos",
  warn: "bg-warn-soft text-warn",
  neg: "bg-neg-soft text-neg",
  info: "bg-info-soft text-info",
  muted: "bg-muted text-muted-foreground",
};

/** Uppercase heading above a group. */
export function SettingsGroupTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="mx-[3px] mt-5 mb-2 flex items-center gap-2 text-[11.5px] font-extrabold tracking-[0.08em] text-muted-foreground uppercase">
      <span>{children}</span>
      {count != null ? (
        <span className="rounded-full border border-border bg-card px-2 py-px text-[10.5px] tabular-nums">
          {count}
        </span>
      ) : null}
    </h2>
  );
}

/** The card a set of rows lives in. */
export function SettingsGroup({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Quiet explanatory paragraph under a group. */
export function SettingsFootnote({ children }: { children: ReactNode }) {
  return (
    <p className="px-5 pt-3.5 pb-1.5 text-center text-[11.5px] leading-relaxed font-semibold text-muted-foreground">
      {children}
    </p>
  );
}

export interface SettingsRowProps {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: SettingsTone;
  label: ReactNode;
  hint?: ReactNode;
  /** Right side: a value string, a pill, or an inline control. */
  value?: ReactNode;
  /** Tap target - when set the row renders as a button with a chevron. */
  onClick?: () => void;
  /** Odjava and friends: label + icon go red. */
  danger?: boolean;
  /** Center the label (used by the standalone Odjava row). */
  center?: boolean;
}

/**
 * One row of a group. Rows with `onClick` are buttons (chevron, press state);
 * rows with an inline control (a switch, a segmented) stay plain containers so
 * the control owns the tap.
 */
export function SettingsRow({
  icon: Icon,
  tone = "accent",
  label,
  hint,
  value,
  onClick,
  danger = false,
  center = false,
}: SettingsRowProps) {
  const body = (
    <>
      {Icon ? (
        <span
          className={cn(
            "grid size-[34px] shrink-0 place-items-center rounded-[11px]",
            danger ? TONE_TILE.neg : TONE_TILE[tone],
          )}
        >
          <Icon className="size-[17px]" />
        </span>
      ) : null}
      <span className={cn("min-w-0", center ? "shrink-0" : "flex-1")}>
        <span
          className={cn("block text-[14.5px] font-bold", danger ? "text-neg" : "text-foreground")}
        >
          {label}
        </span>
        {hint ? (
          <span className="mt-px block text-xs font-semibold text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      {value ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
          {value}
        </span>
      ) : null}
      {onClick ? (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground opacity-60" />
      ) : null}
    </>
  );

  const className = cn(
    "flex w-full min-h-[52px] items-center gap-[11px] border-b border-border px-[13px] py-3 text-left last:border-b-0",
    center && "justify-center",
  );

  if (!onClick) return <div className={className}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        "transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
      )}
    >
      {body}
    </button>
  );
}

/** Status pill for the right-hand side of a row. */
export function SettingsPill({
  tone = "accent",
  children,
}: {
  tone?: SettingsTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-[3px] text-[10.5px] font-extrabold whitespace-nowrap",
        TONE_TILE[tone],
      )}
    >
      {children}
    </span>
  );
}
