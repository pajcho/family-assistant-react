import * as React from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Per-card accent palette. Each accent drives the header icon colour, the
 * default `DashboardCardItem` row tint, and the value text colour. The keys
 * mirror the Vue `variant` union from `components/dashboard/DashboardCard.vue`
 * (`'blue' | 'amber' | 'emerald' | 'purple'`), plus `'red'` for overdue
 * payment rows which never appears as a card-level accent — only on
 * individual `DashboardCardItem` rows.
 */
export type DashboardAccent = "blue" | "amber" | "emerald" | "purple";
export type DashboardItemAccent = DashboardAccent | "red";

export const ACCENT_ICON: Record<DashboardAccent, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  amber: "text-amber-600 dark:text-amber-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  purple: "text-purple-600 dark:text-purple-400",
};

export const ACCENT_MUTED_ICON = "text-gray-400 dark:text-gray-500";

/** Allowed targets for the "Pogledaj sve" link. Matches the protected routes. */
export type DashboardViewAllLink = "/events" | "/payments" | "/birthdays" | "/expenses";

export type DashboardCardProps = {
  /** Heroicon component (24/outline) rendered in the header. */
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  emptyMessage: string;
  addLabel: string;
  /** TanStack Router path used by the "Pogledaj sve" outline button. */
  viewAllLink: DashboardViewAllLink;
  hasItems: boolean;
  /** Drives the header icon colour. Defaults to `blue`. */
  accent?: DashboardAccent;
  onAdd: () => void;
  /** The card item rows. Rendered above the action footer. */
  children?: React.ReactNode;
};

/**
 * Shared chrome for every dashboard card — header (icon + title), items
 * slot, and the "Dodaj X / Pogledaj sve" footer. Mirrors
 * `components/dashboard/DashboardCard.vue` from the Nuxt source.
 *
 * The icon dims to the muted gray when `hasItems === false` (matches Vue's
 * `iconActiveClass` ternary). Items go in the `children` slot — see
 * `DashboardCardItem` for the row component.
 */
export function DashboardCard({
  icon: Icon,
  title,
  emptyMessage,
  addLabel,
  viewAllLink,
  hasItems,
  accent = "blue",
  onAdd,
  children,
}: DashboardCardProps) {
  return (
    <Card className="flex h-full flex-col gap-3 py-4">
      <CardHeader className="px-4 pb-0">
        <div className="flex items-center gap-2">
          <Icon
            className={`h-5 w-5 shrink-0 ${hasItems ? ACCENT_ICON[accent] : ACCENT_MUTED_ICON}`}
          />
          <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-4">
        {hasItems ? (
          <div className="space-y-2">{children}</div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Button size="sm" onClick={onAdd}>
            {addLabel}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={viewAllLink}>Pogledaj sve</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
