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

const SHOPPING_NAME_PATTERN = /sopin|shop|kupovin|namirn|grocer|trznic|pijac|prodavnic|market/i;

/**
 * Whether to offer "Po rafovima" on a list that does not use it yet. Matches
 * the list NAME only: the old content check counted items the keyword
 * dictionary recognised, and with the dictionary gone there is nothing to count
 * until a list has been filed. A list with smart sort already on keeps the
 * option regardless (see useSmartSort).
 */
export function looksLikeShoppingList(name: string): boolean {
  return SHOPPING_NAME_PATTERN.test(
    name
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/đ/gi, "d"),
  );
}
