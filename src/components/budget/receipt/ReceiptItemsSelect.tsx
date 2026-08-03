import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { Amount } from "@/components/common/Amount";
import { stavkeLabel } from "@/utils/plural";

/**
 * Checkbox list over a receipt's lines - the shared selection surface for
 * both split flows: the scan preview (pick which lines THIS expense takes;
 * lines another expense already claimed render disabled with that expense's
 * category chip) and "Podeli račun" in the expense detail (pick which lines
 * move to the new expense). Fully controlled; line `total` sums are the
 * caller's job (they drive the hero amount).
 */

export type SelectableReceiptLine = {
  /** The line's position in the receipt journal - the claim key. */
  idx: number;
  name: string;
  quantity: number | null;
  total: number;
  /** True when an existing expense owns this line (not selectable). */
  claimed?: boolean;
  /** Category of the claiming expense, for the chip; null = uncategorized. */
  claimedCategoryId?: string | null;
};

export type ReceiptItemsSelectProps = {
  lines: SelectableReceiptLine[];
  selected: ReadonlySet<number>;
  onToggle: (idx: number) => void;
  /** Select/clear every free line (the "Sve"/"Nijedna" shortcut). */
  onSetAll: (select: boolean) => void;
  disabled?: boolean;
};

/** Sums a set of line totals in cents to dodge float drift. */
export function sumLineTotals(lines: SelectableReceiptLine[], selected: ReadonlySet<number>) {
  let cents = 0;
  for (const line of lines) {
    if (selected.has(line.idx)) cents += Math.round(line.total * 100);
  }
  return cents / 100;
}

function ClaimChip({ categoryId }: { categoryId: string | null | undefined }) {
  const { categories } = useExpenseCategories();
  const category = categoryId ? categories.find((c) => c.id === categoryId) : null;
  const Icon = category ? categoryIcon(category.icon) : null;
  return (
    <span
      className="inline-flex max-w-28 shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={
        category
          ? { backgroundColor: `${category.color}22`, color: category.color }
          : { backgroundColor: "#9ca3af22", color: "#6b7280" }
      }
    >
      {Icon ? <Icon className="size-2.5 shrink-0" /> : null}
      <span className="truncate">{category ? category.name : "Dodato"}</span>
    </span>
  );
}

export function ReceiptItemsSelect({
  lines,
  selected,
  onToggle,
  onSetAll,
  disabled,
}: ReceiptItemsSelectProps) {
  const free = useMemo(() => lines.filter((l) => !l.claimed), [lines]);
  const allSelected = free.length > 0 && free.every((l) => selected.has(l.idx));

  return (
    <div className="space-y-2">
      {free.length > 1 ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {selected.size} od {free.length} {stavkeLabel(free.length)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={disabled}
            onClick={() => onSetAll(!allSelected)}
          >
            {allSelected ? "Poništi sve" : "Izaberi sve"}
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
        {lines.map((line) => {
          const isClaimed = !!line.claimed;
          const checked = selected.has(line.idx);
          return (
            <li key={line.idx}>
              <label
                className={
                  isClaimed
                    ? "flex cursor-default items-center gap-2 px-3 py-2 text-sm opacity-60"
                    : "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || isClaimed}
                  onChange={() => onToggle(line.idx)}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-default dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
                />
                <span
                  className={
                    "min-w-0 flex-1 truncate " +
                    (isClaimed
                      ? "text-gray-500 dark:text-gray-400"
                      : "text-gray-700 dark:text-gray-200")
                  }
                >
                  {line.name}
                </span>
                {line.quantity != null && line.quantity !== 1 ? (
                  <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                    ×{line.quantity}
                  </span>
                ) : null}
                {isClaimed ? <ClaimChip categoryId={line.claimedCategoryId} /> : null}
                <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
                  <Amount value={line.total} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
