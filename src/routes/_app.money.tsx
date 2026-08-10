import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { MoneyScreen, type MoneyTab } from "@/components/money/MoneyScreen";

/**
 * Money - the redesign merged the budget and payments pages into one
 * destination with three views: overview (the monthly cycle, categories,
 * trend), expenses (the expense timeline) and payments (the payment list, all
 * statuses).
 *
 * `tab` is a search param so each view is linkable - push notifications about
 * a due payment deep-link to `/money?tab=payments`, and the old `/payments`
 * and `/budget` URLs redirect here.
 */

export type { MoneyTab };

export const Route = createFileRoute("/_app/money")({
  validateSearch: (search: Record<string, unknown>): { tab?: MoneyTab } => {
    const tab = search.tab;
    if (tab === "overview" || tab === "expenses" || tab === "payments") return { tab };
    // Unknown values are normalized rather than dropped: the router merges the
    // result over the raw search, so omitting `tab` would leak the raw value.
    return tab == null ? {} : { tab: "overview" };
  },
  component: MoneyPage,
});

function MoneyPage() {
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <MoneyScreen
      tab={tab}
      onTabChange={(next) => {
        void navigate({ to: "/money", search: { tab: next }, replace: true });
      }}
    />
  );
}
