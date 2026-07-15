import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useMerchantCategory } from "@/hooks/useExpenses";
import type { ParsedReceipt } from "@/hooks/useReceiptImport";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { Amount } from "@/components/common/Amount";
import { stavkeLabel } from "@/utils/plural";
import { cn } from "@/lib/cn";

/**
 * Preview + confirm step for a scanned receipt. Amount and date are read-only
 * (they come from the fiscal receipt); the family only chooses a category
 * (preselected from merchant memory), an optional person and a note. The item
 * list is collapsed behind an "N stavki" toggle.
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

/** "2026-01-13T…" → "13.01.2026." */
function formatReceiptDate(issuedAt: string): string {
  const d = issuedAt.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${day}.${m}.${y}.`;
}

export function ReceiptPreview({ receipt, saving, error, onCancel, onSave }: ReceiptPreviewProps) {
  const { categories } = useExpenseCategories();
  const { members } = useFamilyMembers();
  const merchantCategory = useMerchantCategory(receipt.merchant);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [itemsOpen, setItemsOpen] = useState(false);
  const categoryTouched = useRef(false);

  // Preselect the remembered category once, unless the user already picked one.
  useEffect(() => {
    if (categoryTouched.current) return;
    if (merchantCategory.data) setCategoryId(merchantCategory.data);
  }, [merchantCategory.data]);

  const hasItems = receipt.items.length > 0;
  const itemsWarning = receipt.warnings.length > 0;

  return (
    <div className="space-y-5">
      {/* Amount — the hero. */}
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

      {/* Category — chip grid, preselected by merchant memory. */}
      <div className="space-y-2">
        <Label>Kategorija</Label>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nema kategorija.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {categories.map((c) => {
              const selected = categoryId === c.id;
              const Icon = categoryIcon(c.icon);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => {
                    categoryTouched.current = true;
                    setCategoryId(selected ? null : c.id);
                  }}
                  aria-pressed={selected}
                  style={
                    selected ? { backgroundColor: `${c.color}1F`, borderColor: c.color } : undefined
                  }
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
                    selected
                      ? "text-gray-900 dark:text-gray-100"
                      : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
                  )}
                >
                  <Icon className="size-5 shrink-0" style={{ color: c.color }} />
                  <span className="w-full truncate text-[11px] leading-tight">{c.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Items — collapsed by default. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setItemsOpen((v) => !v)}
          aria-expanded={itemsOpen}
          disabled={!hasItems}
          className={cn(
            "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm",
            hasItems ? "text-gray-700 dark:text-gray-200" : "cursor-default text-gray-400",
          )}
        >
          <span className="font-medium">
            {hasItems
              ? `${receipt.items.length} ${stavkeLabel(receipt.items.length)}`
              : "Nema prepoznatih stavki"}
          </span>
          {hasItems ? (
            <ChevronDownIcon
              className={cn("size-4 transition-transform", itemsOpen && "rotate-180")}
            />
          ) : null}
        </button>
        {itemsOpen && hasItems ? (
          <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {receipt.items.map((it, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">
                  {it.name}
                </span>
                {it.quantity != null && it.quantity !== 1 ? (
                  <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                    ×{it.quantity}
                  </span>
                ) : null}
                <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
                  <Amount value={it.total} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {itemsWarning ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          Stavke nisu prepoznate — sačuvaćemo ukupan iznos.
        </p>
      ) : null}

      {/* Person — optional single-select chips. */}
      {members.length > 0 ? (
        <div className="space-y-2">
          <Label>Za koga (opciono)</Label>
          <div className="flex flex-wrap gap-2">
            {members.map((person) => {
              const selected = personId === person.id;
              const color = person.color ?? fallbackColorForProfile(person.id);
              const name =
                getDisplayName({
                  firstName: person.first_name,
                  lastName: person.last_name,
                  email: null,
                }) || "Bez imena";
              return (
                <button
                  type="button"
                  key={person.id}
                  onClick={() => setPersonId(selected ? null : person.id)}
                  aria-pressed={selected}
                  style={
                    selected ? { backgroundColor: `${color}1F`, borderColor: color } : undefined
                  }
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
                    selected
                      ? "text-gray-900 dark:text-gray-100"
                      : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
                  )}
                >
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Note. */}
      <div className="space-y-2">
        <Label htmlFor="receipt-note">Beleška</Label>
        <Input
          id="receipt-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="npr. nedeljna kupovina"
        />
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Odustani
        </Button>
        <Button
          type="button"
          disabled={saving}
          onClick={() =>
            onSave({
              category_id: categoryId,
              person_id: personId,
              note: note.trim() || null,
            })
          }
        >
          {saving ? "Čuvam…" : "Sačuvaj trošak"}
        </Button>
      </div>
    </div>
  );
}
