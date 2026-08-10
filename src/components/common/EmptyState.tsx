import type { ComponentType, ReactNode } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Shared empty-state card - the one component every page renders when there
 * is nothing to show. Two variants with deliberately different tones:
 *
 *   - `starter` - first use, the family has no data of this kind at all.
 *     Dashed border, domain icon in a pastel tile, a title that pitches the
 *     feature (not "no data"), a primary CTA and optional example chips that
 *     open the add flow with the name pre-filled.
 *
 *   - `filter` - data exists but not under the current month/search/filter.
 *     A quiet plain card: one sentence plus an optional escape-hatch link
 *     (clear the filters).
 *
 *   - `overlay` - a floating card over an empty calendar grid (the grid stays
 *     faintly visible behind it, so the screen still reads as a calendar).
 *     The PARENT must be `position: relative`; the overlay pins itself near
 *     the top so it's visible without scrolling on tall grids. No dashed
 *     border, solid background (iOS backdrop-filter is a known hazard here).
 *
 * Tones follow the app-wide per-type accent convention (see navSections
 * menu tiles): event=blue, payment=amber, birthday=emerald,
 * list/activity=purple, expense=rose.
 */

export type EmptyStateTone = "blue" | "amber" | "emerald" | "purple" | "rose" | "gray";

const TONE_CLASSES: Record<EmptyStateTone, { tile: string; icon: string }> = {
  blue: { tile: "bg-info-soft", icon: "text-info" },
  amber: { tile: "bg-warn-soft", icon: "text-warn" },
  emerald: { tile: "bg-pos-soft", icon: "text-pos" },
  purple: { tile: "bg-accent-soft", icon: "text-accent-deep" },
  rose: { tile: "bg-neg-soft", icon: "text-neg" },
  gray: { tile: "bg-muted", icon: "text-muted-foreground" },
};

export type EmptyStateAction = { label: string; onClick: () => void };

export type EmptyStateProps = {
  variant?: "starter" | "filter" | "overlay";
  /** Starter only - domain icon shown in the pastel tile. */
  icon?: ComponentType<{ className?: string }>;
  tone?: EmptyStateTone;
  title?: string;
  description?: string;
  /** Primary CTA (starter) - rendered as a button with a leading plus. */
  action?: EmptyStateAction;
  /** Quiet text link - the escape hatch on `filter`, optional on `starter`. */
  secondaryAction?: EmptyStateAction;
  /**
   * Starter only - example chips ("+ Kirija") that open the add flow with
   * the name pre-filled: one tap less to the first record.
   */
  examples?: EmptyStateAction[];
  className?: string;
  children?: ReactNode;
};

export function EmptyState({
  variant = "starter",
  icon: Icon,
  tone = "gray",
  title,
  description,
  action,
  secondaryAction,
  examples,
  className,
  children,
}: EmptyStateProps) {
  const toneClasses = TONE_CLASSES[tone];

  if (variant === "overlay") {
    return (
      <div
        className={cn(
          // z-20 + rendered AFTER the grid: above the calendars' sticky-left
          // time gutter (z-10) and level with their sticky day headers (z-20,
          // earlier in DOM), while staying under the page-sticky bars (z-30).
          "pointer-events-none absolute inset-0 z-20 flex items-start justify-center px-4 pt-16",
          className,
        )}
      >
        <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow-card">
          {Icon ? (
            <div
              className={cn(
                "mx-auto mb-3 flex size-12 items-center justify-center rounded-full",
                toneClasses.tile,
              )}
            >
              <Icon className={cn("size-6", toneClasses.icon)} />
            </div>
          ) : null}
          {title ? (
            <p className="text-base font-semibold text-balance text-foreground">{title}</p>
          ) : null}
          {description ? (
            <p className={cn("text-sm text-pretty text-muted-foreground", title && "mt-1")}>
              {description}
            </p>
          ) : null}
          {action ? (
            <Button onClick={action.onClick} className="mt-4">
              <PlusIcon className="mr-2 h-5 w-5" />
              {action.label}
            </Button>
          ) : null}
          {examples && examples.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {examples.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={example.onClick}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                >
                  + {example.label}
                </button>
              ))}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    );
  }

  if (variant === "filter") {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-card p-6 text-center shadow-card",
          className,
        )}
      >
        {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
        {description ? (
          <p className={cn("text-sm text-muted-foreground", title && "mt-1")}>{description}</p>
        ) : null}
        {secondaryAction ? (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="mt-2 text-sm font-semibold text-accent-deep underline-offset-4 hover:underline"
          >
            {secondaryAction.label}
          </button>
        ) : null}
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border bg-card p-8 text-center",
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "mx-auto flex size-14 items-center justify-center rounded-full",
            toneClasses.tile,
          )}
        >
          <Icon className={cn("size-7", toneClasses.icon)} />
        </div>
      ) : null}
      {title ? (
        <p className={cn("text-base font-semibold text-balance text-foreground", Icon && "mt-3")}>
          {title}
        </p>
      ) : null}
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? (
        <Button onClick={action.onClick} className="mt-4">
          <PlusIcon className="mr-2 h-5 w-5" />
          {action.label}
        </Button>
      ) : null}
      {examples && examples.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {examples.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={example.onClick}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              + {example.label}
            </button>
          ))}
        </div>
      ) : null}
      {secondaryAction ? (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          className="mt-3 block w-full text-sm font-semibold text-accent-deep underline-offset-4 hover:underline"
        >
          {secondaryAction.label}
        </button>
      ) : null}
      {children}
    </div>
  );
}
