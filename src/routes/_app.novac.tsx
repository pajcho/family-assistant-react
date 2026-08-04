import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { BudgetPage } from "@/components/budget/BudgetPage";
import { PaymentsPage } from "@/components/payments/PaymentsPage";
import { Segmented } from "@/components/common/Segmented";
import { LegacyScreen } from "@/components/layout/AppScreen";

/**
 * "Novac" - the redesign merged Budžet and Plaćanja into one destination with
 * three views: Pregled (the monthly cycle, categories, trend), Troškovi (the
 * expense timeline) and Plaćanja (the payment list, all statuses).
 *
 * `tab` is a search param so each view is linkable - push notifications about
 * a due payment deep-link to `/novac?tab=placanja`, and the old `/payments`
 * and `/budget` URLs redirect here.
 *
 * NOTE (Lane A → Lane D): the segmented header is wired, but the bodies are
 * still the pre-redesign pages. Lane D builds the hub (month pager, QR button
 * in the header) and splits Pregled from Troškovi.
 */

export type NovacTab = "pregled" | "troskovi" | "placanja";

const TABS = [
  { value: "pregled" as const, label: "Pregled" },
  { value: "troskovi" as const, label: "Troškovi" },
  { value: "placanja" as const, label: "Plaćanja" },
];

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
    <LegacyScreen>
      <div className="mx-auto mb-3 w-full max-w-3xl">
        <Segmented
          options={TABS}
          value={tab}
          ariaLabel="Prikaz"
          onChange={(next) => {
            void navigate({ to: "/novac", search: { tab: next }, replace: true });
          }}
        />
      </div>
      {tab === "placanja" ? <PaymentsPage /> : <BudgetPage />}
    </LegacyScreen>
  );
}
