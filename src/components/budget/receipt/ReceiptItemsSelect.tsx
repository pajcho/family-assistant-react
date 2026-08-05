import { useMemo } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { Amount } from "@/components/common/Amount";
import { cn } from "@/lib/cn";
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
      className={cn(
        "inline-flex max-w-28 shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] leading-tight font-bold",
        // Categories carry their own colour; the fallback follows the tokens.
        !category && "bg-muted text-muted-foreground",
      )}
      style={
        category ? { backgroundColor: `${category.color}22`, color: category.color } : undefined
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
          <span className="text-xs font-semibold text-muted-foreground">
            {selected.size} od {free.length} {stavkeLabel(free.length)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-semibold text-accent-deep"
            disabled={disabled}
            onClick={() => onSetAll(!allSelected)}
          >
            {allSelected ? "Poništi sve" : "Izaberi sve"}
          </Button>
        </div>
      ) : null}
      <ul className="rounded-2xl border border-border bg-card px-3 shadow-card">
        {lines.map((line) => {
          const isClaimed = !!line.claimed;
          const checked = selected.has(line.idx);
          return (
            <li key={line.idx} className="border-b border-border last:border-b-0">
              <label
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 py-2.5 text-left transition-opacity",
                  isClaimed && "cursor-default opacity-60",
                  !isClaimed && !checked && "opacity-45",
                )}
              >
                {/* Native checkbox for semantics + keyboard; the box next to it
                    is the visual (the input itself can't carry the tick). */}
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || isClaimed}
                  onChange={() => onToggle(line.idx)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-[9px] border-2 bg-card ring-offset-card transition-colors",
                    "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                    // The tick is pos-soft, not white: white vanishes on the
                    // dark theme's lighter --pos.
                    checked
                      ? "border-pos bg-pos text-pos-soft"
                      : "border-dashed border-border text-transparent",
                  )}
                >
                  <CheckIcon className="size-4" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-normal text-foreground">
                    {line.name}
                  </span>
                  {line.quantity != null && line.quantity !== 1 ? (
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      ×{line.quantity}
                    </span>
                  ) : null}
                </span>
                {isClaimed ? <ClaimChip categoryId={line.claimedCategoryId} /> : null}
                <span className="shrink-0 text-[13.5px] font-bold text-foreground tabular-nums">
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
