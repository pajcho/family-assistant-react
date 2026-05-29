import type { ComponentType, SVGProps } from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardViewAllLink } from "@/components/dashboard/DashboardCard";
import { cn } from "@/lib/cn";

/**
 * Variant palette for the summary card — drives both the header icon color
 * and the big value text. Mirrors the Vue `variant` union in
 * `components/dashboard/DashboardSummaryCard.vue`.
 */
export type DashboardSummaryVariant = "default" | "success" | "warning" | "muted";

const ICON_CLASS: Record<DashboardSummaryVariant, string> = {
  default: "text-gray-500 dark:text-gray-400",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  muted: "text-gray-400 dark:text-gray-500",
};

const VALUE_CLASS: Record<DashboardSummaryVariant, string> = {
  default: "text-gray-900 dark:text-gray-100",
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  muted: "text-gray-500 dark:text-gray-400",
};

export type DashboardSummaryCardProps = {
  title: string;
  /** Headline value (`number` is rendered as-is). */
  displayValue: string | number;
  subtitle?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  variant?: DashboardSummaryVariant;
  actionLabel?: string;
  onAction?: () => void;
  /** TanStack Router path for the optional outline "Pogledaj" button. */
  to?: DashboardViewAllLink;
};

/**
 * Direct port of `components/dashboard/DashboardSummaryCard.vue` — a compact
 * widget rendering a single metric with an optional inline action +
 * "Pogledaj" link. The Vue dashboard doesn't currently render this component
 * (it's available for future use), but it's part of the agreed Phase 4
 * surface so we keep the React port for parity.
 */
export function DashboardSummaryCard({
  title,
  displayValue,
  subtitle,
  icon: Icon,
  variant = "default",
  actionLabel,
  onAction,
  to,
}: DashboardSummaryCardProps) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4 pb-0">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-5 w-5 shrink-0", ICON_CLASS[variant])} />
          <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <div className={cn("text-2xl font-bold", VALUE_CLASS[variant])}>{displayValue}</div>
        {subtitle ? (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        ) : null}
        {(actionLabel || to) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {actionLabel && onAction ? (
              <Button size="sm" onClick={onAction}>
                {actionLabel}
              </Button>
            ) : null}
            {to ? (
              <Button asChild variant="outline" size="sm">
                <Link to={to}>Pogledaj</Link>
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
