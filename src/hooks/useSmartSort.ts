import { useAutoCategorize } from "@/hooks/useAutoCategorize";
import { useShoppingListDetection } from "@/hooks/useShoppingListDetection";
import { useDismissAisleSuggestion, useToggleSmartSort } from "@/hooks/useTasks";
import { SHOPPING_LIST_THRESHOLD, toShopCategory, type ShopCategory } from "@/lib/shopCategories";
import type { ListWithTasks } from "@/types/database";

/**
 * Smart-sort surface for a single list.
 *
 *   • `isShopping`    - offer "Po rafovima" at all? True once Jev has judged
 *     the list a shopping list (whatever it is called), or when smart sort is
 *     already on, so the option never disappears from under a list using it.
 *   • `suggestAisles` - show the one-time suggestion to switch: a judged
 *     shopping list that is not sorted by aisle and has not answered yet.
 *   • `enabled`       - current state of the persistent toggle, sourced from
 *     `list.smart_sort_enabled`. Drives whether the UI renders department
 *     headers, and whether the list's unfiled items get filed.
 *   • `toggle()`      - flips the flag, which also answers the suggestion.
 *   • `dismissSuggestion()` - closes the suggestion for the whole family.
 *
 * Mounting this also files the list's unfiled items (useAutoCategorize) and
 * judges the list as it grows (useShoppingListDetection), so it belongs to the
 * one screen that shows a single open list.
 *
 * The actual toggle mutation lives in `useToggleSmartSort` so multiple UI
 * surfaces share a single source of behaviour.
 */
export interface UseSmartSortResult {
  isShopping: boolean;
  suggestAisles: boolean;
  enabled: boolean;
  toggle: () => Promise<void>;
  dismissSuggestion: () => void;
  isPending: boolean;
}

export function useSmartSort(list: ListWithTasks): UseSmartSortResult {
  const toggleMutation = useToggleSmartSort();
  const dismissMutation = useDismissAisleSuggestion();
  useAutoCategorize(list);
  useShoppingListDetection(list);

  const judgedShopping = (list.shopping_likelihood ?? 0) >= SHOPPING_LIST_THRESHOLD;

  return {
    isShopping: list.smart_sort_enabled || judgedShopping,
    suggestAisles: !list.smart_sort_enabled && judgedShopping && !list.aisle_suggestion_dismissed,
    enabled: list.smart_sort_enabled,
    toggle: () => toggleMutation.mutateAsync({ list, enabled: !list.smart_sort_enabled }),
    dismissSuggestion: () => dismissMutation.mutate(list.id),
    isPending: toggleMutation.isPending,
  };
}

/**
 * Group items by department, preserving their existing order. The renderer
 * relies on the list's `smart_sort_enabled` flag to guarantee items are
 * already in department order (see applyTaskOrdering in useTasks) - this just
 * walks them and emits one entry per (department, items) run.
 */
export interface CategoryGroup {
  category: ShopCategory;
  items: ListWithTasks["tasks"];
}

export function groupByCategory(items: ListWithTasks["tasks"]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  for (const item of items) {
    const category = toShopCategory(item.category);
    const tail = groups[groups.length - 1];
    if (tail && tail.category === category) {
      tail.items.push(item);
    } else {
      groups.push({ category, items: [item] });
    }
  }
  return groups;
}
