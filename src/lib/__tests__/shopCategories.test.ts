import { describe, expect, it } from "vitest";

import { applyCategorySort, shouldCheckShoppingList, toShopCategory } from "@/lib/shopCategories";

describe("toShopCategory", () => {
  it("reads an unfiled item and an unknown key as other, so every item renders", () => {
    expect(toShopCategory(null)).toBe("other");
    expect(toShopCategory(undefined)).toBe("other");
    expect(toShopCategory("electronics")).toBe("other");
    expect(toShopCategory("dairy")).toBe("dairy");
  });
});

describe("applyCategorySort", () => {
  const item = (name: string, category: string | null, sort_order: number) => ({
    name,
    category,
    sort_order,
  });

  it("walks the shop in order and parks unfiled items with other at the end", () => {
    const sorted = applyCategorySort([
      item("Novo", null, 1),
      item("Kafa", "pantry", 2),
      item("Mleko", "dairy", 3),
      item("Oprati kola", "other", 4),
      item("Jabuke", "fruits_veg", 5),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(["Jabuke", "Mleko", "Kafa", "Novo", "Oprati kola"]);
  });

  it("keeps the manual order inside a department, so re-sorting never scrambles it", () => {
    const once = applyCategorySort([
      item("Jogurt", "dairy", 3),
      item("Mleko", "dairy", 1),
      item("Sir", "dairy", 2),
    ]);
    expect(once.map((i) => i.name)).toEqual(["Mleko", "Sir", "Jogurt"]);
    expect(applyCategorySort(once)).toEqual(once);
  });
});

describe("shouldCheckShoppingList", () => {
  it("first judges a list at two items", () => {
    expect(shouldCheckShoppingList(1, null)).toBe(false);
    expect(shouldCheckShoppingList(2, null)).toBe(true);
  });

  it("re-judges only once the list has doubled, so a growing list costs log2(n) calls", () => {
    expect(shouldCheckShoppingList(3, 2)).toBe(false);
    expect(shouldCheckShoppingList(4, 2)).toBe(true);
    expect(shouldCheckShoppingList(7, 4)).toBe(false);
    expect(shouldCheckShoppingList(8, 4)).toBe(true);
  });
});
