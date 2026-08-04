import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { NovacScreen, type NovacTab } from "@/components/money/NovacScreen";

/**
 * "Novac" - the redesign merged Budžet and Plaćanja into one destination with
 * three views: Pregled (the monthly cycle, categories, trend), Troškovi (the
 * expense timeline) and Plaćanja (the payment list, all statuses).
 *
 * `tab` is a search param so each view is linkable - push notifications about
 * a due payment deep-link to `/novac?tab=placanja`, and the old `/payments`
 * and `/budget` URLs redirect here.
 */

export type { NovacTab };

export const Route = createFileRoute("/_app/novac")({
  validateSearch: (search: Record<string, unknown>): { tab?: NovacTab } => {
    const tab = search.tab;
    if (tab === "pregled" || tab === "troskovi" || tab === "placanja") return { tab };
    // Unknown values are normalized rather than dropped: the router merges the
    // result over the raw search, so omitting `tab` would leak the raw value.
    return tab == null ? {} : { tab: "pregled" };
  },
  component: NovacPage,
});

function NovacPage() {
  const { tab = "pregled" } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <NovacScreen
      tab={tab}
      onTabChange={(next) => {
        void navigate({ to: "/novac", search: { tab: next }, replace: true });
      }}
    />
  );
}
