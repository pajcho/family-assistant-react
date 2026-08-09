import { Suspense, useEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon, QrCodeIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { Segmented } from "@/components/common/Segmented";
import { BudgetPage } from "@/components/budget/BudgetPage";
import { PaymentsPage } from "@/components/payments/PaymentsPage";
import { ALL_MONTHS, MonthPager } from "@/components/money/MonthPager";
import { HeaderIconButton } from "@/components/money/moneyUi";
// Lazy chunk: the scanner pulls in the camera code + the wasm QR reader, so it
// must stay out of the main bundle.
import { ReceiptScanDialog } from "@/components/budget/receipt/lazyReceiptScanDialog";
import type { Expense } from "@/types/database";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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

/** Same settle time as the global search palette. */
const SEARCH_DEBOUNCE_MS = 250;

const TABS = [
  { value: "pregled" as const, label: "Pregled" },
  { value: "troskovi" as const, label: "Troškovi" },
  { value: "placanja" as const, label: "Plaćanja" },
];

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
  // Troškovi searches over the network (`useExpenseSearch`), so it may only see
  // settled input - a raw term meant one query per keystroke. The field itself
  // stays on `searchTerm` and is unaffected; Plaćanja filters its already-loaded
  // list in a memo, so it keeps the instant term too.
  const debouncedTerm = useDebouncedValue(searchTerm, SEARCH_DEBOUNCE_MS);
  // An empty box fires no query, so there is nothing to wait for: clearing the
  // field (or closing the search) drops the hits in the same commit instead of
  // leaving them standing for another 250 ms.
  const expenseSearchTerm = searchTerm === "" ? "" : debouncedTerm;

  const [scanOpen, setScanOpen] = useState(false);
  // Stays true after the first open so the lazy chunk loads once and the close
  // animation can play; the dialog releases the camera whenever `open` is false.
  const [scanMounted, setScanMounted] = useState(false);
  // Set while the scanner is attaching its receipt to an expense that already
  // exists (Troškovi → izmeni → "Skeniraj račun") instead of creating one. Not
  // cleared on close - `openScan` resets it, so the sheet doesn't flip out of
  // attach mode mid-exit-animation.
  const [attachTarget, setAttachTarget] = useState<Expense | null>(null);
  // Where the active view portals its "Dodaj" (see the header below).
  const [addSlot, setAddSlot] = useState<HTMLElement | null>(null);

  const isPayments = tab === "placanja";
  const budgetMonth = month === ALL_MONTHS ? currentMonthYYYYMM() : month;

  // Leaving Plaćanja with the all-time view on would leave the pager showing
  // "Sva plaćanja" over a single month's budget - snap back instead.
  useEffect(() => {
    if (!isPayments && month === ALL_MONTHS) setMonth(currentMonthYYYYMM());
  }, [isPayments, month]);

  const openScan = () => {
    setAttachTarget(null);
    setScanMounted(true);
    setScanOpen(true);
  };

  const openAttach = (expense: Expense) => {
    setAttachTarget(expense);
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
            {/* The active view's "Dodaj" portals in here. The button belongs
                with the rest of the screen chrome, but the dialogs behind it
                (and their state) belong to the view - a slot keeps both where
                they should be instead of hoisting three dialogs into the hub.
                `display: contents` so the portalled button joins this flex row
                directly. */}
            <span ref={setAddSlot} className="contents" />
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
          className="w-full rounded-lg border border-border bg-card px-[13px] py-3 text-sm font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
    // ONE column width for all three views. It used to widen for Pregled and
    // narrow for the two lists, which moved the tab strip and the month pager
    // sideways on every tab change - the header is the fixed part of the
    // screen and must not jump. `max-w-3xl` is the app's standard reading
    // column, so Novac now lines up with Danas, Liste and the rest.
    <AppScreen header={header} bodyClassName="pb-6" contentClassName="mx-auto w-full max-w-3xl">
      {isPayments ? (
        <PaymentsPage month={month} searchTerm={searchTerm} addSlot={addSlot} />
      ) : (
        <BudgetPage
          view={tab === "troskovi" ? "troskovi" : "pregled"}
          month={budgetMonth}
          onMonthChange={setMonth}
          searchTerm={expenseSearchTerm}
          onScanReceipt={openScan}
          onAttachReceipt={openAttach}
          addSlot={addSlot}
        />
      )}

      {scanMounted ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog
            open={scanOpen}
            onOpenChange={setScanOpen}
            onJumpToMonth={setMonth}
            attachTo={attachTarget}
          />
        </Suspense>
      ) : null}
    </AppScreen>
  );
}
