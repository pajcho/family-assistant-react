import type { ComponentType, ReactNode, SVGProps } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * Shared visual language for entity DETAIL sheets (payment / event / birthday /
 * activity occurrence / Google event): a hero row on top, state as badge
 * pills, label-value info rows, then every action as a big bordered row with
 * icon + label + description (the BlockActionDialog pattern). Sub-flows keep
 * living on the sheet stack (see `useSheetStack`); these are only the shared
 * building blocks each dialog composes.
 */

export type DetailHeroProps = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Colorway of the icon circle, e.g. "bg-amber-100 dark:bg-amber-900/50". */
  iconWrapClassName: string;
  /** Icon colorway, e.g. "text-amber-600 dark:text-amber-400". */
  iconClassName: string;
  title: ReactNode;
  /** Extra classes on the title (e.g. line-through for canceled entities). */
  titleClassName?: string;
  subtitle?: ReactNode;
};

export function DetailHero({
  icon: Icon,
  iconWrapClassName,
  iconClassName,
  title,
  titleClassName,
  subtitle,
}: DetailHeroProps) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
          iconWrapClassName,
        )}
      >
        <Icon className={cn("h-6 w-6", iconClassName)} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-lg font-semibold text-gray-900 dark:text-gray-100",
            titleClassName,
          )}
        >
          {title}
        </p>
        {subtitle ? <p className="text-sm text-gray-600 dark:text-gray-400">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export type DetailBadge = {
  label: string;
  /** Pill colorway, e.g. "bg-emerald-100 text-emerald-700 …". */
  className: string;
};

/** The state pills under the hero. Renders nothing without badges. */
export function DetailBadgeRow({ badges }: { badges: ReadonlyArray<DetailBadge> }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={cn("rounded-full px-2 py-0.5 text-xs font-medium", badge.className)}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

/** Hairline-divided label-value list ("Za", "Opis", …). */
export function DetailInfoRows({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-gray-100 border-t border-gray-100 text-sm dark:divide-gray-700/60 dark:border-gray-700/60">
      {children}
    </div>
  );
}

export function DetailInfoRow({
  label,
  align = "center",
  children,
}: {
  label: string;
  /** "baseline" for multi-line text values, "center" for badges/chips. */
  align?: "center" | "baseline";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-3 py-2.5",
        align === "center" ? "items-center" : "items-baseline",
      )}
    >
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </div>
  );
}

/** Convenience info row for plain text values (right-aligned, medium weight). */
export function DetailInfoText({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <DetailInfoRow label={label} align="baseline">
      <span
        className={cn("text-right font-medium text-gray-900 dark:text-gray-100", valueClassName)}
      >
        {value}
      </span>
    </DetailInfoRow>
  );
}

export type DetailActionTone = "default" | "muted" | "primary" | "destructive";

export type DetailActionRowProps = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  description?: string;
  /** Renders an <a target="_blank"> instead of a button (external links). */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * "primary" is the sheet's ONE emphasized (emerald) action - the last row.
   * "destructive" for delete-like rows, "muted" for quiet state-restores.
   */
  tone?: DetailActionTone;
  /** Right chevron for drill-in rows that open a sub-view rather than act. */
  chevron?: boolean;
};

const ACTION_TONE_CLASSES: Record<
  DetailActionTone,
  { row: string; icon: string; label: string; description: string }
> = {
  default: {
    row: "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800",
    icon: "text-gray-700 dark:text-gray-200",
    label: "text-gray-900 dark:text-gray-100",
    description: "text-muted-foreground",
  },
  muted: {
    row: "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800",
    icon: "text-gray-500",
    label: "text-gray-900 dark:text-gray-100",
    description: "text-muted-foreground",
  },
  primary: {
    row: "border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50 dark:border-emerald-800/70 dark:bg-emerald-900/15 dark:hover:bg-emerald-900/25",
    icon: "text-emerald-600 dark:text-emerald-400",
    label: "text-emerald-800 dark:text-emerald-300",
    description: "text-emerald-700/70 dark:text-emerald-400/70",
  },
  destructive: {
    row: "border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30",
    icon: "text-red-600 dark:text-red-400",
    label: "text-red-600 dark:text-red-400",
    description: "text-muted-foreground",
  },
};

/**
 * One action as a bordered, thumb-friendly row: icon + label + short
 * description of what will happen. Extracted from BlockActionDialog so every
 * detail sheet renders identical rows.
 */
export function DetailActionRow({
  icon: Icon,
  label,
  description,
  href,
  onClick,
  disabled,
  tone = "default",
  chevron = false,
}: DetailActionRowProps) {
  const classes = ACTION_TONE_CLASSES[tone];
  const rowClassName = cn(
    "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
    "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    classes.row,
  );
  const body = (
    <>
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", classes.icon)} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", classes.label)}>{label}</div>
        {description ? (
          <div className={cn("text-xs", classes.description)}>{description}</div>
        ) : null}
      </div>
      {chevron ? (
        <ChevronRightIcon className="mt-1 size-4 shrink-0 text-gray-400 dark:text-gray-500" />
      ) : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={rowClassName}
      >
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={rowClassName}>
      {body}
    </button>
  );
}

/** Uniform spacing wrapper around a sheet's DetailActionRow stack. */
export function DetailActionList({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
