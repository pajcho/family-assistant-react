/**
 * The category facet's pure half, shared by Troškovi and Plaćanja.
 *
 * Kept out of the component file on purpose: `CategoryFilterChip` reaches
 * `lib/supabase` through `useExpenseCategories`, and a test importing anything
 * from that chain has no Supabase env on CI.
 */

/**
 * Sentinel for the "Bez kategorije" bucket. Rows carry `category_id: null`,
 * which a `Set<string>` cannot hold - and this doubles as the key of the
 * uncategorized row in the Pregled breakdown, so the two agree by construction.
 */
export const UNCATEGORIZED = "__none__";

/** Whether a row's `category_id` passes the selection (empty set = no filter). */
export function matchesCategoryFilter(
  categoryId: string | null,
  selected: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  return selected.has(categoryId ?? UNCATEGORIZED);
}

/** Add/remove one key, with the empty-set = "no filter" convention preserved. */
export function toggleInSet(prev: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
