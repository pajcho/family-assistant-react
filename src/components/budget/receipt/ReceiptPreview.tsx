import { AdjustmentsHorizontalIcon, ListBulletIcon, TagIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsDesktop } from "@/components/ui/responsive-dialog";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { PickerRow } from "@/components/common/PickerRow";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { CategoryGridPicker } from "@/components/budget/CategoryGridPicker";
import { EXPENSE_LINK_KINDS, ExpensePersonSelect } from "@/components/budget/ExpenseForm";
import { PaymentLinkField, type PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import { receiptSuggestContext } from "@/utils/linkSuggestions";
import { PaymentLinkPickerSheet } from "@/components/payments/PaymentLinkPickerSheet";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import type { ParsedReceipt } from "@/hooks/useReceiptImport";
import { Amount } from "@/components/common/Amount";
import { stavkeLabel } from "@/utils/plural";
import {
  ReceiptItemsSelect,
  type SelectableReceiptLine,
} from "@/components/budget/receipt/ReceiptItemsSelect";

/**
 * Preview + confirm step for a scanned receipt, on the "Brzi unos" pattern.
 * The date comes from the fiscal receipt; the AMOUNT is the sum of the
 * selected lines - when the receipt's lines are complete (they add up to its
 * total) each line gets a checkbox, so part of the receipt can be saved as
 * one expense and the rest claimed later (or immediately, via the host's
 * "Dodaj ostatak" chain step). Lines another expense already claimed render
 * disabled with that expense's category chip. When lines are missing or
 * don't add up, selection is off and the receipt saves whole, like before.
 *
 * Mobile collapses the editable bits into picker rows (Kategorija / Stavke /
 * Više detalja) that swap the sheet to a sub-view with a "←" header; desktop
 * shows everything inline. In `attachMode` - a receipt landing on an expense
 * that already exists - only Stavke is left: everything else is already
 * filled in on that expense and stays.
 *
 * Fully CONTROLLED: the hosting `ReceiptScanDialog` owns the sub-view, the
 * field values AND the line selection, because a sub-view opening over the
 * preview remounts this component and local state would lose what the user
 * picked.
 */

// "link" is one level deeper than the others: Detalji → Poveži sa (the
// ExpenseFormDialog nesting, so a scanned receipt links exactly like a typed
// expense).
export type ReceiptPreviewView = "main" | "category" | "details" | "items" | "link";

export type ReceiptPreviewProps = {
  receipt: ParsedReceipt;
  /** The receipt's lines with claim state - the source of truth for the list. */
  lines: SelectableReceiptLine[];
  /** True when per-line selection is allowed (complete, consistent lines). */
  selectable: boolean;
  selected: ReadonlySet<number>;
  onToggleLine: (idx: number) => void;
  onSetAllLines: (select: boolean) => void;
  /** Sum of the selected lines' totals (the amount that will be saved). */
  selectedSum: number;
  /** True when some lines are already claimed (re-scan of a partial receipt). */
  partial: boolean;
  /**
   * The receipt is being attached to an expense that already exists, so the
   * fields it already has (kategorija / za koga / beleška / poveži sa) are not
   * ours to set - only the amount and the items change. Hides those rows.
   */
  attachMode?: boolean;
  saving: boolean;
  error: string | null;
  view: ReceiptPreviewView;
  /** Mobile picker rows push a sub-view onto the host dialog's sheet stack. */
  onOpenView: (view: Exclude<ReceiptPreviewView, "main">) => void;
  /** "←" in a sub-view header - pops back to the main view. */
  onBack: () => void;
  categoryId: string | null;
  onCategoryChange: (id: string | null) => void;
  personId: string | null;
  onPersonChange: (id: string | null) => void;
  note: string;
  onNoteChange: (note: string) => void;
  /** Optional activity/event link - same field the manual expense form has. */
  link: PaymentLinkValue | null;
  onLinkChange: (link: PaymentLinkValue | null) => void;
  onCancel: () => void;
  onSave: () => void;
};

/** "2026-01-13T…" (or a bare date) → "13.01.2026." */
function formatReceiptDate(issuedAt: string): string {
  const d = issuedAt.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${day}.${m}.${y}.`;
}

export function ReceiptPreview({
  receipt,
  lines,
  selectable,
  selected,
  onToggleLine,
  onSetAllLines,
  selectedSum,
  partial,
  attachMode = false,
  saving,
  error,
  view,
  onOpenView,
  onBack,
  categoryId,
  onCategoryChange,
  personId,
  onPersonChange,
  note,
  onNoteChange,
  link,
  onLinkChange,
  onCancel,
  onSave,
}: ReceiptPreviewProps) {
  const isDesktop = useIsDesktop();
  const { categories } = useExpenseCategories();

  const hasItems = lines.length > 0;
  const selectedCategory = categoryId ? categories.find((c) => c.id === categoryId) : null;
  const heroAmount = selectable ? selectedSum : receipt.totalAmount;
  const showReceiptTotal =
    Math.round(heroAmount * 100) !== Math.round(receipt.totalAmount * 100) || partial;
  const nothingSelected = selectable && selected.size === 0;

  const amountHero = (
    <div className="rounded-2xl border border-border bg-card p-4 text-center shadow-card">
      <div className="text-[34px] font-bold tracking-[-0.03em] text-foreground tabular-nums">
        <Amount value={heroAmount} />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
        {receipt.merchant ? (
          <span className="font-semibold text-foreground">{receipt.merchant}</span>
        ) : null}
        <span>· {formatReceiptDate(receipt.issuedAt)}</span>
      </div>
      {showReceiptTotal ? (
        <div className="mt-1 text-[11px] font-bold tracking-[0.07em] text-muted-foreground uppercase">
          Ceo račun · <Amount value={receipt.totalAmount} />
        </div>
      ) : null}
    </div>
  );

  const warningsBlock =
    receipt.warnings.length > 0
      ? receipt.warnings.map((warning) => (
          <p
            key={warning}
            className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-normal text-warn"
          >
            {warning}
          </p>
        ))
      : null;

  // Complete lines → selectable checkboxes; incomplete → the read-only list
  // and a note that this receipt can only be saved whole.
  const mismatchNote =
    hasItems && !selectable ? (
      <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-normal text-warn">
        Stavke se ne poklapaju sa ukupnim iznosom, pa račun može da se doda samo ceo.
      </p>
    ) : null;

  const itemsList = !hasItems ? (
    <p className="text-sm text-muted-foreground">Nema prepoznatih stavki.</p>
  ) : selectable ? (
    <ReceiptItemsSelect
      lines={lines}
      selected={selected}
      onToggle={onToggleLine}
      onSetAll={onSetAllLines}
      disabled={saving}
    />
  ) : (
    <ul className="rounded-2xl border border-border bg-card px-3 shadow-card">
      {lines.map((it) => (
        <li
          key={it.idx}
          className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-normal text-foreground">
              {it.name}
            </span>
            {it.quantity != null && it.quantity !== 1 ? (
              <span className="block text-[11px] text-muted-foreground tabular-nums">
                ×{it.quantity}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[13.5px] font-bold text-foreground tabular-nums">
            <Amount value={it.total} />
          </span>
        </li>
      ))}
    </ul>
  );

  const noteField = (
    <div className="space-y-2">
      <Label htmlFor="receipt-note">Beleška</Label>
      <Input
        id="receipt-note"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="npr. nedeljna kupovina"
      />
    </div>
  );

  // --- Sub-views (mobile) ---
  if (view === "category") {
    return (
      <>
        <SheetStackHeader title="Kategorija" onBack={onBack} />
        <CategoryGridPicker
          value={categoryId}
          onChange={(id) => {
            onCategoryChange(id);
            onBack();
          }}
        />
      </>
    );
  }
  if (view === "items") {
    return (
      <>
        <SheetStackHeader title="Stavke" onBack={onBack} />
        <div className="space-y-3">
          {selectable ? (
            <p className="text-xs text-muted-foreground">
              Odčekiraj stavke koje ne pripadaju ovom trošku - možeš da ih dodaš kao poseban trošak
              odmah posle čuvanja.
            </p>
          ) : null}
          {mismatchNote}
          {itemsList}
        </div>
      </>
    );
  }
  if (view === "details") {
    return (
      <>
        <SheetStackHeader title="Detalji" onBack={onBack} />
        <div className="space-y-4">
          <ExpensePersonSelect value={personId} onChange={onPersonChange} />
          {noteField}
          <PaymentLinkField
            value={link}
            onChange={onLinkChange}
            kinds={EXPENSE_LINK_KINDS}
            suggest={receiptSuggestContext(receipt)}
            // Mobile-only sub-view: full-sheet picker instead of a popover.
            onOpenPicker={() => onOpenView("link")}
          />
        </div>
      </>
    );
  }
  if (view === "link") {
    return (
      <>
        <SheetStackHeader title="Poveži sa" onBack={onBack} />
        <PaymentLinkPickerSheet
          value={link}
          onChange={onLinkChange}
          onDone={onBack}
          kinds={EXPENSE_LINK_KINDS}
          suggest={receiptSuggestContext(receipt)}
        />
      </>
    );
  }

  // --- Main view ---
  const footer = (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="outline"
        className="h-auto rounded-[15px] border-border bg-card py-[13px] text-[15px] font-bold text-muted-foreground"
        onClick={onCancel}
        disabled={saving}
      >
        Odustani
      </Button>
      <Button
        type="button"
        className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold"
        disabled={saving || nothingSelected}
        onClick={onSave}
      >
        {saving ? "Čuvam…" : attachMode ? "Poveži račun" : "Sačuvaj trošak"}
      </Button>
    </div>
  );

  const errorBlock = error ? (
    <div className="rounded-xl bg-neg-soft p-3 text-sm font-normal text-neg">{error}</div>
  ) : null;

  // Same "Više detalja" summary the manual expense form builds.
  const detailParts: string[] = [];
  if (personId) detailParts.push("Za koga ✓");
  if (note.trim()) detailParts.push("Beleška ✓");
  if (link) detailParts.push("Povezano ✓");
  const detailCount = detailParts.length;

  const freeCount = lines.filter((l) => !l.claimed).length;
  const itemsSummary = !hasItems
    ? "Nema stavki"
    : selectable
      ? `${selected.size} od ${freeCount} ${stavkeLabel(freeCount)}`
      : `${lines.length} ${stavkeLabel(lines.length)}`;

  // Attach mode says out loud what it will and won't touch, so nobody has to
  // wonder whether scanning is about to overwrite the category they picked.
  const attachNote = attachMode ? (
    <p className="rounded-xl bg-accent-soft px-3 py-2 text-xs font-normal text-accent-deep">
      Trošak dobija iznos i stavke sa ovog računa. Datum, kategorija i ostalo ostaju kako si uneo.
    </p>
  ) : null;

  return (
    <>
      <SheetStackHeader
        title={attachMode ? "Poveži račun" : partial ? "Preostale stavke" : "Pregled računa"}
        description={
          attachMode
            ? "Proveri iznos i izaberi stavke koje pripadaju ovom trošku."
            : partial
              ? "Deo ovog računa je već dodat - biraš među preostalim stavkama."
              : "Proveri iznos i izaberi kategoriju pre nego što sačuvaš."
        }
      />
      {isDesktop ? (
        // --- Desktop: everything inline ---
        <div className="space-y-5">
          {amountHero}
          {attachNote}
          {attachMode ? null : (
            <div className="space-y-2">
              <Label>Kategorija</Label>
              <CategoryGridPicker value={categoryId} onChange={onCategoryChange} />
            </div>
          )}
          <div className="space-y-2">
            <Label>Stavke</Label>
            {mismatchNote}
            {itemsList}
          </div>
          {warningsBlock}
          {attachMode ? null : (
            <>
              <ExpensePersonSelect value={personId} onChange={onPersonChange} />
              {noteField}
              <PaymentLinkField
                value={link}
                onChange={onLinkChange}
                kinds={EXPENSE_LINK_KINDS}
                suggest={receiptSuggestContext(receipt)}
              />
            </>
          )}
          {errorBlock}
          {footer}
        </div>
      ) : (
        // --- Mobile: "Brzi unos" picker rows ---
        <div className="space-y-5">
          {amountHero}
          {attachNote}
          {warningsBlock}
          <div className="space-y-2">
            {attachMode ? null : (
              <PickerRow
                title="Kategorija"
                summary={selectedCategory ? selectedCategory.name : "Bez kategorije"}
                icon={
                  selectedCategory ? (
                    (() => {
                      const Icon = categoryIcon(selectedCategory.icon);
                      return <Icon className="size-4" style={{ color: selectedCategory.color }} />;
                    })()
                  ) : (
                    <TagIcon className="size-4" />
                  )
                }
                onClick={() => onOpenView("category")}
              />
            )}
            <PickerRow
              title="Stavke"
              summary={itemsSummary}
              icon={<ListBulletIcon className="size-4" />}
              disabled={!hasItems}
              onClick={() => onOpenView("items")}
            />
            {attachMode ? null : (
              <PickerRow
                title="Više detalja"
                summary={
                  detailCount > 0 ? detailParts.join(" · ") : "Za koga · beleška · poveži sa"
                }
                icon={<AdjustmentsHorizontalIcon className="size-4" />}
                count={detailCount}
                onClick={() => onOpenView("details")}
              />
            )}
          </div>
          {errorBlock}
          {footer}
        </div>
      )}
    </>
  );
}
