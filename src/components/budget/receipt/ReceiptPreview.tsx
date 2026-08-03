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

/**
 * Preview + confirm step for a scanned receipt, on the "Brzi unos" pattern.
 * Amount and date are read-only (they come from the fiscal receipt); the
 * family only chooses a category (preselected from merchant memory), an
 * optional person and a note.
 *
 * Mobile collapses the editable bits into picker rows (Kategorija / Stavke /
 * Više detalja) that swap the sheet to a sub-view with a "←" header; desktop
 * shows everything inline. Fully CONTROLLED: the hosting `ReceiptScanDialog`
 * owns both the sub-view (its sheet stack routes drawer dismissals back to
 * this main view instead of closing the flow) and the field values (the
 * stack's mobile close→reopen hop remounts this component - local state would
 * lose what the user picked).
 */

export type ReceiptPreviewView = "main" | "category" | "details" | "items";

export type ReceiptPreviewProps = {
  receipt: ParsedReceipt;
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

/** "2026-01-13T…" → "13.01.2026." */
function formatReceiptDate(issuedAt: string): string {
  const d = issuedAt.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${day}.${m}.${y}.`;
}

export function ReceiptPreview({
  receipt,
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

  const hasItems = receipt.items.length > 0;
  const selectedCategory = categoryId ? categories.find((c) => c.id === categoryId) : null;

  const amountHero = (
    <div className="text-center">
      <div className="text-4xl font-semibold tabular-nums text-gray-900 dark:text-white">
        <Amount value={receipt.totalAmount} />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-sm text-gray-500 dark:text-gray-400">
        {receipt.merchant ? (
          <span className="font-medium text-gray-700 dark:text-gray-200">{receipt.merchant}</span>
        ) : null}
        <span>· {formatReceiptDate(receipt.issuedAt)}</span>
      </div>
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

  const itemsList = hasItems ? (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
      {receipt.items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
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
  ) : (
    <p className="text-sm text-muted-foreground">Nema prepoznatih stavki.</p>
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
        {itemsList}
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
      <Button type="button" disabled={saving} onClick={onSave}>
        {saving ? "Čuvam…" : "Sačuvaj trošak"}
      </Button>
    </div>
  );

  const errorBlock = error ? (
    <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
      {error}
    </div>
  ) : null;

  return (
    <>
      <SheetStackHeader
        title="Pregled računa"
        description="Proveri iznos i izaberi kategoriju pre nego što sačuvaš."
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
              summary={
                hasItems
                  ? `${receipt.items.length} ${stavkeLabel(receipt.items.length)}`
                  : "Nema stavki"
              }
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
