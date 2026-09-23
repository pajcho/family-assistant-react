import { useAutoCategorize } from "@/hooks/useAutoCategorize";
import { useToggleSmartSort } from "@/hooks/useTasks";
import { looksLikeShoppingList, toShopCategory, type ShopCategory } from "@/lib/shopCategories";
import type { ListWithTasks } from "@/types/database";

/**
 * Smart-sort surface for a single list.
 *
 *   • `isShopping` - offer "Po rafovima" at all? True when the list's name
 *     reads like a shopping list, or when smart sort is already on, so the
 *     option never disappears from under a list that uses it.
 *   • `enabled`    - current state of the persistent toggle, sourced from
 *     `list.smart_sort_enabled`. Drives whether the UI renders department
 *     headers, and whether the list's unfiled items get filed.
 *   • `toggle()`   - flips the flag. A plain boolean write; the order itself is
 *     a view-time projection of the stored categories.
 *
 * Mounting this also files the list's unfiled items (see useAutoCategorize), so
 * it belongs to the one screen that shows a single open list.
 *
 * The actual toggle mutation lives in `useToggleSmartSort` so multiple UI
 * surfaces share a single source of behaviour.
 */
export interface UseSmartSortResult {
  isShopping: boolean;
  enabled: boolean;
  toggle: () => Promise<void>;
  isPending: boolean;
}

export function useSmartSort(list: ListWithTasks): UseSmartSortResult {
  const toggleMutation = useToggleSmartSort();
  useAutoCategorize(list);

  return {
    isShopping: list.smart_sort_enabled || looksLikeShoppingList(list.name),
    enabled: list.smart_sort_enabled,
    toggle: () => toggleMutation.mutateAsync({ list, enabled: !list.smart_sort_enabled }),
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
