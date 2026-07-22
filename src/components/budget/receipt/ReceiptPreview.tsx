import { useEffect, useRef, useState } from "react";
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
import { useMerchantCategory } from "@/hooks/useExpenses";
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
 * shows everything inline. Self-contained: it owns its own view stack, header
 * and footer, so the host dialog renders no header for this mode.
 */

export type ReceiptSavePayload = {
  category_id: string | null;
  person_id: string | null;
  note: string | null;
};

export type ReceiptPreviewProps = {
  receipt: ParsedReceipt;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload: ReceiptSavePayload) => void;
};

type View = "main" | "category" | "details" | "items";

/** "2026-01-13T…" → "13.01.2026." */
function formatReceiptDate(issuedAt: string): string {
  const d = issuedAt.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${day}.${m}.${y}.`;
}

export function ReceiptPreview({ receipt, saving, error, onCancel, onSave }: ReceiptPreviewProps) {
  const isDesktop = useIsDesktop();
  const { categories } = useExpenseCategories();
  const merchantCategory = useMerchantCategory(receipt.merchant);

  const [view, setView] = useState<View>("main");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const categoryTouched = useRef(false);

  // Preselect the remembered category once, unless the user already picked one.
  useEffect(() => {
    if (categoryTouched.current) return;
    if (merchantCategory.data) setCategoryId(merchantCategory.data);
  }, [merchantCategory.data]);

  const hasItems = receipt.items.length > 0;
  const selectedCategory = categoryId ? categories.find((c) => c.id === categoryId) : null;

  const setCategory = (id: string | null) => {
    categoryTouched.current = true;
    setCategoryId(id);
  };

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
        onChange={(e) => setNote(e.target.value)}
        placeholder="npr. nedeljna kupovina"
      />
    </div>
  );

  // ——— Sub-views (mobile) ———
  if (view === "category") {
    return (
      <>
        <SheetStackHeader title="Kategorija" onBack={() => setView("main")} />
        <CategoryGridPicker
          value={categoryId}
          onChange={(id) => {
            setCategory(id);
            setView("main");
          }}
        />
      </>
    );
  }
  if (view === "items") {
    return (
      <>
        <SheetStackHeader title="Stavke" onBack={() => setView("main")} />
        {itemsList}
      </>
    );
  }
  if (view === "details") {
    return (
      <>
        <SheetStackHeader title="Detalji" onBack={() => setView("main")} />
        <div className="space-y-4">
          <ExpensePersonSelect value={personId} onChange={setPersonId} />
          {noteField}
        </div>
      </>
    );
  }

  // ——— Main view ———
  const footer = (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
        Odustani
      </Button>
      <Button
        type="button"
        disabled={saving}
        onClick={() =>
          onSave({ category_id: categoryId, person_id: personId, note: note.trim() || null })
        }
      >
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
        // ——— Desktop: everything inline ———
        <div className="space-y-5">
          {amountHero}
          <div className="space-y-2">
            <Label>Kategorija</Label>
            <CategoryGridPicker value={categoryId} onChange={setCategory} />
          </div>
          <div className="space-y-2">
            <Label>Stavke</Label>
            {itemsList}
          </div>
          {warningsBlock}
          <ExpensePersonSelect value={personId} onChange={setPersonId} />
          {noteField}
          {errorBlock}
          {footer}
        </div>
      ) : (
        // ——— Mobile: "Brzi unos" picker rows ———
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
              onClick={() => setView("category")}
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
              onClick={() => setView("items")}
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
              onClick={() => setView("details")}
            />
          </div>
          {errorBlock}
          {footer}
        </div>
      )}
    </>
  );
}
