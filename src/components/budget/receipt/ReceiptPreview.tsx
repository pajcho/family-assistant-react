import { AdjustmentsHorizontalIcon, ListBulletIcon, TagIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsDesktop } from "@/components/ui/responsive-dialog";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { PickerRow } from "@/components/common/PickerRow";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { CategoryGridPicker } from "@/components/budget/CategoryGridPicker";
import { ExpensePersonSelect } from "@/components/budget/ExpenseForm";
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
 * shows everything inline. Fully CONTROLLED: the hosting `ReceiptScanDialog`
 * owns the sub-view, the field values AND the line selection (the stack's
 * mobile close→reopen hop remounts this component - local state would lose
 * what the user picked).
 */

export type ReceiptPreviewView = "main" | "category" | "details" | "items";

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
    <div className="text-center">
      <div className="text-4xl font-semibold tabular-nums text-gray-900 dark:text-white">
        <Amount value={heroAmount} />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-sm text-gray-500 dark:text-gray-400">
        {receipt.merchant ? (
          <span className="font-medium text-gray-700 dark:text-gray-200">{receipt.merchant}</span>
        ) : null}
        <span>· {formatReceiptDate(receipt.issuedAt)}</span>
      </div>
      {showReceiptTotal ? (
        <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
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
            className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          >
            {warning}
          </p>
        ))
      : null;

  // Complete lines → selectable checkboxes; incomplete → the read-only list
  // and a note that this receipt can only be saved whole.
  const mismatchNote =
    hasItems && !selectable ? (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
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
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
      {lines.map((it) => (
        <li key={it.idx} className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">
            {it.name}
          </span>
          {it.quantity != null && it.quantity !== 1 ? (
            <span className="shrink-0 text-xs text-gray-400 tabular-nums">×{it.quantity}</span>
          ) : null}
          <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
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
            <p className="text-xs text-gray-500 dark:text-gray-400">
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
        </div>
      </>
    );
  }

  // --- Main view ---
  const footer = (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
        Odustani
      </Button>
      <Button type="button" disabled={saving || nothingSelected} onClick={onSave}>
        {saving ? "Čuvam…" : "Sačuvaj trošak"}
      </Button>
    </div>
  );

  const errorBlock = error ? (
    <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
      {error}
    </div>
  ) : null;

  const freeCount = lines.filter((l) => !l.claimed).length;
  const itemsSummary = !hasItems
    ? "Nema stavki"
    : selectable
      ? `${selected.size} od ${freeCount} ${stavkeLabel(freeCount)}`
      : `${lines.length} ${stavkeLabel(lines.length)}`;

  return (
    <>
      <SheetStackHeader
        title={partial ? "Preostale stavke" : "Pregled računa"}
        description={
          partial
            ? "Deo ovog računa je već dodat - biraš među preostalim stavkama."
            : "Proveri iznos i izaberi kategoriju pre nego što sačuvaš."
        }
      />
      {isDesktop ? (
        // --- Desktop: everything inline ---
        <div className="space-y-5">
          {amountHero}
          <div className="space-y-2">
            <Label>Kategorija</Label>
            <CategoryGridPicker value={categoryId} onChange={onCategoryChange} />
          </div>
          <div className="space-y-2">
            <Label>Stavke</Label>
            {mismatchNote}
            {itemsList}
          </div>
          {warningsBlock}
          <ExpensePersonSelect value={personId} onChange={onPersonChange} />
          {noteField}
          {errorBlock}
          {footer}
        </div>
      ) : (
        // --- Mobile: "Brzi unos" picker rows ---
        <div className="space-y-5">
          {amountHero}
          {warningsBlock}
          <div className="space-y-2">
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
            <PickerRow
              title="Stavke"
              summary={itemsSummary}
              icon={<ListBulletIcon className="size-4" />}
              disabled={!hasItems}
              onClick={() => onOpenView("items")}
            />
            <PickerRow
              title="Više detalja"
              summary={
                (personId ? 1 : 0) + (note.trim() ? 1 : 0) > 0
                  ? "Za koga / beleška ✓"
                  : "Za koga · beleška"
              }
              icon={<AdjustmentsHorizontalIcon className="size-4" />}
              count={(personId ? 1 : 0) + (note.trim() ? 1 : 0)}
              onClick={() => onOpenView("details")}
            />
          </div>
          {errorBlock}
          {footer}
        </div>
      )}
    </>
  );
}
