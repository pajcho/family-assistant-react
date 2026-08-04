import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon, QrCodeIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { Segmented } from "@/components/common/Segmented";
import { BudgetPage } from "@/components/budget/BudgetPage";
import { PaymentsPage } from "@/components/payments/PaymentsPage";
import { ALL_MONTHS, MonthPager } from "@/components/money/MonthPager";
import { HeaderIconButton } from "@/components/money/moneyUi";
import { currentMonthYYYYMM } from "@/utils/date";

/**
 * "Novac" - the redesign's single money destination. Budžet and Plaćanja used
 * to be two pages with two toolbars; they are now three views of one screen:
 *
 *   Pregled   - the monthly cycle, categories, fixed vs variable, trend
 *   Troškovi  - the day-by-day expense ledger with its source facets
 *   Plaćanja  - the payment list, all statuses
 *
 * The hub owns everything the three views share, so switching tabs never
 * resets your place: the month (one pager for all three), the search field,
 * and the receipt scanner behind the QR button. Each view keeps its own
 * filters and dialogs.
 */

export type NovacTab = "pregled" | "troskovi" | "placanja";

const TABS = [
  { value: "pregled" as const, label: "Pregled" },
  { value: "troskovi" as const, label: "Troškovi" },
  { value: "placanja" as const, label: "Plaćanja" },
];

// Lazy chunk: the scanner pulls in the camera code + the wasm QR reader, so it
// must stay out of the main bundle. Loaded on the first "Skeniraj račun".
const ReceiptScanDialog = lazy(() => import("@/components/budget/receipt/ReceiptScanDialog"));

export function NovacScreen({
  tab,
  onTabChange,
}: {
  tab: NovacTab;
  onTabChange: (next: NovacTab) => void;
}) {
  // One month for all three views. "all" (Sva plaćanja) only exists on the
  // Plaćanja tab; the budget views fall back to the current month, and the
  // pager itself snaps back the moment you leave that tab.
  const [month, setMonth] = useState<string>(() => currentMonthYYYYMM());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);

  const [scanOpen, setScanOpen] = useState(false);
  // Stays true after the first open so the lazy chunk loads once and the close
  // animation can play; the dialog releases the camera whenever `open` is false.
  const [scanMounted, setScanMounted] = useState(false);

  const isPayments = tab === "placanja";
  const budgetMonth = month === ALL_MONTHS ? currentMonthYYYYMM() : month;

  // Leaving Plaćanja with the all-time view on would leave the pager showing
  // "Sva plaćanja" over a single month's budget - snap back instead.
  useEffect(() => {
    if (!isPayments && month === ALL_MONTHS) setMonth(currentMonthYYYYMM());
  }, [isPayments, month]);

  const openScan = () => {
    setScanMounted(true);
    setScanOpen(true);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchTerm("");
  };

  const toggleSearch = () => {
    if (searchOpen) {
      closeSearch();
      return;
    }
    setSearchOpen(true);
    // Pregled has nothing to search - the query is over expenses, so land the
    // user where the hits will show up.
    if (tab === "pregled") onTabChange("troskovi");
    // The field mounts in the same commit; focus it once it exists.
    requestAnimationFrame(() => searchInput.current?.focus());
  };

  // Pregled is a summary, not a list: going back to it while a query is open
  // would leave hits standing in for the cycle card. Drop the search instead.
  const handleTabChange = (next: NovacTab) => {
    if (next === "pregled" && searchOpen) closeSearch();
    onTabChange(next);
  };

  const searching = searchTerm.trim().length > 0;

  const header = (
    <div className="space-y-2.5">
      <ScreenHeaderRow
        title="Novac"
        actions={
          <>
            <HeaderIconButton icon={QrCodeIcon} label="Skeniraj račun" onClick={openScan} />
            <HeaderIconButton
              icon={searchOpen ? XMarkIcon : MagnifyingGlassIcon}
              label={searchOpen ? "Zatvori pretragu" : "Pretraga"}
              onClick={toggleSearch}
              active={searchOpen}
            />
          </>
        }
      />
      {searchOpen ? (
        <input
          ref={searchInput}
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={isPayments ? "Pretraži plaćanja…" : "Pretraži troškove i stavke…"}
          aria-label={isPayments ? "Pretraži plaćanja" : "Pretraži troškove"}
          className="w-full rounded-lg border border-border bg-card px-[13px] py-3 text-sm font-semibold placeholder:font-semibold placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      ) : null}
      <Segmented options={TABS} value={tab} ariaLabel="Prikaz" onChange={handleTabChange} />
      {/* While searching the results span every month, so a month pager would
          only lie about what is on screen. */}
      {searching ? null : (
        <MonthPager
          value={month}
          onChange={setMonth}
          allOptionLabel={isPayments ? "Sva plaćanja" : undefined}
        />
      )}
    </div>
  );

  return (
    <AppScreen header={header} bodyClassName="pb-6">
      {isPayments ? (
        <PaymentsPage month={month} searchTerm={searchTerm} />
      ) : (
        <BudgetPage
          view={tab === "troskovi" ? "troskovi" : "pregled"}
          month={budgetMonth}
          onMonthChange={setMonth}
          searchTerm={searchTerm}
          onScanReceipt={openScan}
        />
      )}

      {scanMounted ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog open={scanOpen} onOpenChange={setScanOpen} onJumpToMonth={setMonth} />
        </Suspense>
      ) : null}
    </AppScreen>
  );
}
