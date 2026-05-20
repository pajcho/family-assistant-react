import { useMemo } from "react";
import { toast } from "sonner";

import { useReorderListItems } from "@/hooks/useLists";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categorize,
  isShoppingList,
  type GroceryCategory,
} from "@/lib/groceryCategorize";
import type { ListWithItems } from "@/types/database";

/**
 * Smart-sort entry point for a single list.
 *
 * Given the live list (with items), it:
 *   • flags `isShopping` so the UI knows whether to render the button
 *   • exposes `sortItems()` which renumbers `sort_order` so items group
 *     by supermarket aisle in `CATEGORY_ORDER`
 *
 * The within-category order is preserved — i.e. if the user had "Mleko"
 * before "Sir" before sorting, they stay in that order inside the dairy
 * group. That's important because shoppers often mentally pair items
 * (e.g. yoghurt + the specific brand of granola next to it) and we don't
 * want to scramble those associations.
 *
 * Detection AND categorisation share `useMemo` against the items array,
 * so re-renders without item changes don't re-run the keyword loop.
 */
export interface UseSmartSortResult {
  isShopping: boolean;
  /** Diagnostics — what fraction of items were recognised as groceries. */
  recognisedRatio: number;
  sortItems: () => Promise<void>;
  isPending: boolean;
}

export function useSmartSort(list: ListWithItems): UseSmartSortResult {
  const reorder = useReorderListItems();

  // Categorise once per items array. Each entry pairs the item with its
  // resolved category so downstream code (sort, header rendering) doesn't
  // re-run the keyword loop.
  const annotated = useMemo(
    () => list.list_items.map((item) => ({ item, category: categorize(item.name) })),
    [list.list_items],
  );

  const itemNames = useMemo(
    () => list.list_items.map((i) => i.name),
    [list.list_items],
  );
  const { isShopping, recognisedRatio } = useMemo(
    () => isShoppingList(list.name, itemNames),
    [list.name, itemNames],
  );

  const sortItems = async () => {
    if (annotated.length === 0) return;

    // Sort primarily by CATEGORY_ORDER index, secondarily by the item's
    // current sort_order so within-category order is preserved (stable
    // sort property of Array.prototype.sort is relied on; spec-mandated
    // since ES2019).
    const sorted = [...annotated].sort((a, b) => {
      const aIdx = CATEGORY_ORDER.indexOf(a.category);
      const bIdx = CATEGORY_ORDER.indexOf(b.category);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.item.sort_order - b.item.sort_order;
    });

    const updates = sorted.map((entry, idx) => ({
      id: entry.item.id,
      sort_order: idx + 1, // 1-indexed, matches the rest of the codebase
    }));

    await reorder.mutateAsync(updates);

    const distinct = new Set(annotated.map((a) => a.category));
    const ostalo = distinct.has("other");
    const groceryCount = distinct.size - (ostalo ? 1 : 0);
    toast.success(
      groceryCount > 0
        ? `Sortirano u ${groceryCount} ${groceryCount === 1 ? "kategoriju" : "kategorija"}`
        : "Sortirano",
    );
  };

  return {
    isShopping,
    recognisedRatio,
    sortItems,
    isPending: reorder.isPending,
  };
}

/**
 * Walk the (already-sorted) items and detect whether they form clean
 * contiguous groups by category. Used by the renderer to decide whether
 * to inject category headers — we only want headers when they actually
 * structure the data, not when categories interleave.
 *
 * Returns the categorised items, plus a flag indicating clean-grouping.
 * O(n) — no map allocations beyond a `Set` of already-seen categories.
 */
export interface CategorisedItems {
  entries: Array<{ item: ListWithItems["list_items"][number]; category: GroceryCategory }>;
  cleanGrouped: boolean;
}

export function categoriseInOrder(items: ListWithItems["list_items"]): CategorisedItems {
  const entries = items.map((item) => ({ item, category: categorize(item.name) }));

  let cleanGrouped = true;
  const seen = new Set<GroceryCategory>();
  let previous: GroceryCategory | null = null;
  for (const { category } of entries) {
    if (category !== previous) {
      // Crossing into a new (or revisited) category.
      if (seen.has(category)) {
        // We've already left this category before — items are interleaved.
        cleanGrouped = false;
        break;
      }
      if (previous !== null) seen.add(previous);
      previous = category;
    }
  }

  return { entries, cleanGrouped };
}

export { CATEGORY_LABEL };
