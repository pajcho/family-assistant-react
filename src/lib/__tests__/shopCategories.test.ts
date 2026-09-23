import { describe, expect, it } from "vitest";

import { applyCategorySort, looksLikeShoppingList, toShopCategory } from "@/lib/shopCategories";

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

describe("looksLikeShoppingList", () => {
  it("recognises a shopping list by name, with or without diacritics", () => {
    expect(looksLikeShoppingList("Shopping")).toBe(true);
    expect(looksLikeShoppingList("Šoping")).toBe(true);
    expect(looksLikeShoppingList("Tržnica subota")).toBe(true);
    expect(looksLikeShoppingList("Todo")).toBe(false);
    expect(looksLikeShoppingList("Obroci 25 Maj")).toBe(false);
  });
});
