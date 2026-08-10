import type { ComponentType, ReactNode, SVGProps } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/cn";

/**
 * Shared visual language for entity DETAIL sheets (payment / event / birthday /
 * activity occurrence / Google event): a hero row on top, state as badge
 * pills, label-value info rows in a bordered card, then every action as a big
 * bordered row with icon + label + description.
 *
 * The ORDER of the actions is domain knowledge that lives in each dialog and
 * must not change (payment: mark paid -> edit -> history -> reschedule
 * -> cancel -> pause -> delete). These are only the shared pieces each
 * dialog composes; sub-flows keep living on the sheet stack (`useSheetStack`).
 */

/** Semantic colourways for the hero square and badge pills. */
export type DetailTone = "accent" | "pos" | "warn" | "neg" | "info" | "neutral";

const TONE_SURFACE: Record<DetailTone, string> = {
  accent: "bg-accent-soft text-accent-deep",
  pos: "bg-pos-soft text-pos",
  warn: "bg-warn-soft text-warn",
  neg: "bg-neg-soft text-neg",
  info: "bg-info-soft text-info",
  neutral: "bg-muted text-muted-foreground",
};

export type DetailHeroProps = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Semantic colourway of the icon square. Defaults to the app accent. */
  tone?: DetailTone;
  /** Escape hatch for member-coloured heroes; overrides `tone`. */
  iconWrapClassName?: string;
  iconClassName?: string;
  title: ReactNode;
  /** Extra classes on the title (e.g. line-through for canceled entities). */
  titleClassName?: string;
  subtitle?: ReactNode;
};

export function DetailHero({
  icon: Icon,
  tone = "accent",
  iconWrapClassName,
  iconClassName,
  title,
  titleClassName,
  subtitle,
}: DetailHeroProps) {
  return (
    <div className="flex items-center gap-3 pb-1">
      <div
        className={cn(
          "grid size-[50px] shrink-0 place-items-center rounded-[17px]",
          iconWrapClassName ?? TONE_SURFACE[tone],
        )}
      >
        <Icon className={cn("size-6", iconClassName)} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-lg leading-tight font-bold", titleClassName)}>{title}</p>
        {subtitle ? (
          <p className="mt-0.5 text-[13px] font-normal text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

export type DetailBadge = {
  label: string;
  /** Semantic colourway; `className` still wins when both are given. */
  tone?: DetailTone;
  /** Raw pill classes - kept for call sites with bespoke colours. */
  className?: string;
};

/** The state pills under the hero. Renders nothing without badges. */
export function DetailBadgeRow({ badges }: { badges: ReadonlyArray<DetailBadge> }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
            badge.className ?? TONE_SURFACE[badge.tone ?? "neutral"],
          )}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

/** Hairline-divided label-value card ("Za", "Kategorija", "Podsetnik", …). */
export function DetailInfoRows({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-[13.5px]">
      {children}
    </div>
  );
}

export function DetailInfoRow({
  label,
  icon: Icon,
  align = "center",
  children,
}: {
  label: string;
  /** Leading glyph, matching the prototype's ".drow svg". */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** "baseline" for multi-line text values, "center" for badges/chips. */
  align?: "center" | "baseline";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-2.5 px-3.5 py-2.5",
        align === "center" ? "items-center" : "items-baseline",
      )}
    >
      {Icon ? (
        <Icon className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
      ) : null}
      <span className="min-w-0 flex-1 font-normal text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Convenience info row for plain text values (right-aligned, bold). */
export function DetailInfoText({
  label,
  icon,
  value,
  valueClassName,
}: {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <DetailInfoRow label={label} icon={icon} align="baseline">
      <span className={cn("text-right font-semibold tabular-nums", valueClassName)}>{value}</span>
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
   * "primary" is the sheet's ONE emphasized action and always sits FIRST;
   * "destructive" is the delete row and always sits LAST. "muted" is for quiet
   * state-restores.
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
    row: "border-border bg-card hover:bg-muted",
    icon: "text-muted-foreground",
    label: "text-foreground",
    description: "text-muted-foreground",
  },
  muted: {
    row: "border-border bg-card hover:bg-muted",
    icon: "text-muted-foreground/70",
    label: "text-muted-foreground",
    description: "text-muted-foreground",
  },
  primary: {
    row: "border-accent bg-accent text-accent-foreground hover:bg-accent/90",
    icon: "text-accent-foreground",
    label: "text-accent-foreground",
    description: "text-accent-foreground/80",
  },
  destructive: {
    row: "border-border bg-card hover:bg-neg-soft",
    icon: "text-neg",
    label: "text-neg",
    description: "text-muted-foreground",
  },
};

/**
 * One action as a bordered, thumb-friendly row: icon + label + short
 * description of what will happen.
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
    "flex min-h-11 w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    classes.row,
  );
  const body = (
    <>
      <Icon className={cn("size-[17px] shrink-0", classes.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-semibold", classes.label)}>{label}</div>
        {description ? (
          <div className={cn("text-xs leading-snug", classes.description)}>{description}</div>
        ) : null}
      </div>
      {chevron ? (
        <ChevronRightIcon className={cn("size-4 shrink-0", classes.icon)} aria-hidden="true" />
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
  return <div className="flex flex-col gap-2">{children}</div>;
}

/**
 * The "delete" sub-view's question, identical on every detail sheet.
 *
 * `note` is the entity's extra consequence, inserted between the question and
 * the "cannot be undone" line - deleting an activity also deletes its slots,
 * and that is the kind of thing you have to be told BEFORE you confirm.
 */
export function DetailDeleteBody({ name, note }: { name: string; note?: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {`Da li ste sigurni da želite da obrišete „${name}"?${note ? ` ${note}` : ""} Ova radnja se ne može opozvati.`}
    </p>
  );
}

/**
 * The "delete" sub-view's footer: back to the actions, or delete to go
 * through with it.
 *
 * `Nazad` (not `Odustani`) because the delete view is a step INSIDE the sheet,
 * not a form of its own. The destructive button shows a pending label while the
 * request is in flight - three of the four sheets used to say nothing at all,
 * so a slow delete looked like a dead button.
 */
export function DetailDeleteFooter({
  deleting,
  onBack,
  onConfirm,
}: {
  deleting: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <ResponsiveDialogFooter>
      <Button variant="outline" onClick={onBack} disabled={deleting}>
        Nazad
      </Button>
      <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
        {deleting ? "Brišem…" : "Obriši"}
      </Button>
    </ResponsiveDialogFooter>
  );
}
