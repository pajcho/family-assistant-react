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
 *     ("Očisti filtere").
 *
 * Tones follow the app-wide per-type accent convention (see AddMenu / AppNav
 * "Više" tiles): event=blue, payment=amber, birthday=emerald, list=purple,
 * activity=violet, expense=rose.
 */

export type EmptyStateTone = "blue" | "amber" | "emerald" | "purple" | "violet" | "rose" | "gray";

const TONE_CLASSES: Record<EmptyStateTone, { tile: string; icon: string }> = {
  blue: { tile: "bg-blue-100 dark:bg-blue-900/40", icon: "text-blue-600 dark:text-blue-400" },
  amber: { tile: "bg-amber-100 dark:bg-amber-900/40", icon: "text-amber-600 dark:text-amber-400" },
  emerald: {
    tile: "bg-emerald-100 dark:bg-emerald-900/40",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  purple: {
    tile: "bg-purple-100 dark:bg-purple-900/40",
    icon: "text-purple-600 dark:text-purple-400",
  },
  violet: {
    tile: "bg-violet-100 dark:bg-violet-900/40",
    icon: "text-violet-600 dark:text-violet-400",
  },
  rose: { tile: "bg-rose-100 dark:bg-rose-900/40", icon: "text-rose-600 dark:text-rose-400" },
  gray: { tile: "bg-gray-100 dark:bg-gray-700", icon: "text-gray-600 dark:text-gray-300" },
};

export type EmptyStateAction = { label: string; onClick: () => void };

export type EmptyStateProps = {
  variant?: "starter" | "filter";
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

  if (variant === "filter") {
    return (
      <div
        className={cn(
          "rounded-lg border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800",
          className,
        )}
      >
        {title ? (
          <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
        ) : null}
        {description ? (
          <p className={cn("text-sm text-gray-500 dark:text-gray-400", title && "mt-1")}>
            {description}
          </p>
        ) : null}
        {secondaryAction ? (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="mt-2 text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
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
        "rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800",
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
        <p
          className={cn(
            "text-base font-semibold text-balance text-gray-900 dark:text-white",
            Icon && "mt-3",
          )}
        >
          {title}
        </p>
      ) : null}
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-gray-500 dark:text-gray-400">
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
              className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-200 dark:hover:bg-gray-700"
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
          className="mt-3 block w-full text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
        >
          {secondaryAction.label}
        </button>
      ) : null}
      {children}
    </div>
  );
}
