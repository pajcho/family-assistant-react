import { useMemo } from "react";

import { useToggleSmartSort } from "@/hooks/useLists";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categorize,
  isShoppingList,
  type GroceryCategory,
} from "@/lib/groceryCategorize";
import type { ListWithItems } from "@/types/database";

/**
 * Smart-sort surface for a single list.
 *
 *   • `isShopping` — should the toggle button even be shown? Combines a
 *     name-pattern hit with a content-ratio check so personal todo lists
 *     don't get the button at all.
 *   • `enabled`    — current state of the persistent toggle, sourced from
 *     `list.smart_sort_enabled`. Drives whether the UI renders category
 *     headers and whether `useCreateListItem` / `useUpdateListItem`
 *     trigger auto-resort on item changes.
 *   • `toggle()`   — flips the flag (and, when turning on, runs an
 *     initial sort so the list is immediately grouped by aisle).
 *
 * The actual reorder mutation lives in `useToggleSmartSort` so multiple
 * UI surfaces (full-page header today, anywhere else tomorrow) share a
 * single source of behaviour.
 */
export interface UseSmartSortResult {
  isShopping: boolean;
  enabled: boolean;
  recognisedRatio: number;
  toggle: () => Promise<void>;
  isPending: boolean;
}

export function useSmartSort(list: ListWithItems): UseSmartSortResult {
  const toggleMutation = useToggleSmartSort();

  const itemNames = useMemo(
    () => list.list_items.map((i) => i.name),
    [list.list_items],
  );
  const { isShopping, recognisedRatio } = useMemo(
    () => isShoppingList(list.name, itemNames),
    [list.name, itemNames],
  );

  return {
    isShopping,
    enabled: list.smart_sort_enabled,
    recognisedRatio,
    toggle: () =>
      toggleMutation.mutateAsync({ list, enabled: !list.smart_sort_enabled }),
    isPending: toggleMutation.isPending,
  };
}

/**
 * Group items by category, preserving their existing order. The renderer
 * relies on the list's `smart_sort_enabled` flag (and the corresponding
 * auto-resort on insert/rename) to guarantee items are already in the
 * right order — this function just walks them and emits one entry per
 * (category, items) run.
 */
export interface CategoryGroup {
  category: GroceryCategory;
  items: ListWithItems["list_items"];
}

export function groupByCategory(items: ListWithItems["list_items"]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  for (const item of items) {
    const category = categorize(item.name);
    const tail = groups[groups.length - 1];
    if (tail && tail.category === category) {
      tail.items.push(item);
    } else {
      groups.push({ category, items: [item] });
    }
  }
  return groups;
}

export { CATEGORY_LABEL, CATEGORY_ORDER };
