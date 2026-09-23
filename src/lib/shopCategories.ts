/**
 * Shop departments a smart-sorted list groups its items by.
 *
 * Which department an item belongs to is decided server-side by Jev (the
 * categorize-tasks edge function) and stored on `tasks.category`; this module
 * only names the departments and orders them. The key set must equal the
 * prompt in supabase/functions/_shared/shopCategories.ts, and
 * shopCategories.parity.test.ts next to it fails the build if they drift.
 *
 * There is no product dictionary here any more, and that is the point: a new
 * product needs no code, and a new department is one line here plus one hint
 * in the prompt.
 */

/**
 * Iteration order doubles as render order: one walk through a Serbian
 * supermarket, fresh food by the entrance, chilled and frozen next, dry goods
 * and drinks, then non-food, and the unfiled leftovers at the very end.
 */
export const SHOP_CATEGORY_ORDER = [
  "fruits_veg",
  "bakery",
  "dairy",
  "meat_fish",
  "frozen",
  "ready_meals",
  "pantry",
  "sweets_snacks",
  "drinks",
  "cleaning",
  "hygiene",
  "baby",
  "pets",
  "household",
  "office_school",
  "other",
] as const;

export type ShopCategory = (typeof SHOP_CATEGORY_ORDER)[number];

/** Inline group headers. */
export const SHOP_CATEGORY_LABEL: Record<ShopCategory, string> = {
  fruits_veg: "Voće i povrće",
  bakery: "Pekara",
  dairy: "Mlečni proizvodi i jaja",
  meat_fish: "Meso i riba",
  frozen: "Smrznuto",
  ready_meals: "Gotova jela",
  pantry: "Osnovne namirnice",
  sweets_snacks: "Slatkiši i grickalice",
  drinks: "Piće",
  cleaning: "Kućna hemija i papir",
  hygiene: "Lična higijena i kozmetika",
  baby: "Bebi program",
  pets: "Kućni ljubimci",
  household: "Domaćinstvo i elektronika",
  office_school: "Kancelarijski i školski pribor",
  other: "Ostalo",
};

const RANK = new Map<string, number>(SHOP_CATEGORY_ORDER.map((category, i) => [category, i]));

/**
 * A stored `tasks.category` as a department. NULL means "not filed yet" (just
 * added, just renamed, or the model was unreachable) and an unknown key means
 * the server knows a department this build does not; both read as `other`, so
 * the item always renders and simply moves once it is filed.
 */
export function toShopCategory(value: string | null | undefined): ShopCategory {
  return value != null && RANK.has(value) ? (value as ShopCategory) : "other";
}

/**
 * Order items by department, breaking ties by their persisted `sort_order`, so
 * the result is stable: sorting twice gives the same order and items inside a
 * department never scramble between renders.
 */
export function applyCategorySort<T extends { category: string | null; sort_order: number }>(
  items: T[],
): T[] {
  const rank = (item: T) => RANK.get(toShopCategory(item.category)) ?? RANK.size;
  return [...items].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);
}

/**
 * Whether a list is a shopping list is judged by Jev (the detect-shopping-list
 * function) from its name and items, not matched against a list of names: a
 * regex knew "Shopping" but not "za kupiti", and could not tell a meal diary
 * full of food from a list of things to buy.
 *
 * These two rules mirror supabase/functions/_shared/shopCategories.ts, where
 * the function enforces them; the parity test next to it keeps them equal.
 */

/** At or above this `lists.shopping_likelihood` the list is a shopping list. */
export const SHOPPING_LIST_THRESHOLD = 0.5;

/** The first judgement waits for this many items. */
export const MIN_ITEMS_FOR_LIST_CHECK = 2;

/**
 * Whether a list with `itemCount` items is due for a judgement, given how many
 * it had at the last one: first at MIN_ITEMS_FOR_LIST_CHECK, then each time the
 * list has doubled.
 */
export function shouldCheckShoppingList(itemCount: number, checkedItems: number | null): boolean {
  return itemCount >= Math.max(MIN_ITEMS_FOR_LIST_CHECK, 2 * (checkedItems ?? 0));
}
