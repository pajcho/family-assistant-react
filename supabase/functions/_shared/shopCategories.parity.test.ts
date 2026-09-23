import { describe, expect, it } from "vitest";

import {
  MIN_ITEMS_FOR_LIST_CHECK as serverMinItems,
  SHOP_CATEGORY_HINTS,
  SHOPPING_LIST_THRESHOLD as serverThreshold,
  shouldCheckShoppingList as serverShouldCheck,
} from "./shopCategories.ts";
import {
  MIN_ITEMS_FOR_LIST_CHECK as clientMinItems,
  SHOP_CATEGORY_LABEL,
  SHOP_CATEGORY_ORDER,
  SHOPPING_LIST_THRESHOLD as clientThreshold,
  shouldCheckShoppingList as clientShouldCheck,
} from "@/lib/shopCategories";

/**
 * The department set exists twice: here in Deno, as the prompt that makes Jev
 * choose, and in the app, as the labels and the walk order it renders. They
 * cannot import each other (different runtimes, no bundler on the edge), so
 * this is what keeps them equal.
 *
 * A drift fails quietly otherwise. A key the prompt knows and the app does not
 * gets filed, stored, and then shown under "Ostalo" forever; a key the app
 * knows and the prompt does not is a header nothing can ever land in.
 */
describe("shop categories: server prompt vs client labels", () => {
  it("offer the model exactly the departments the app can show", () => {
    const server = Object.keys(SHOP_CATEGORY_HINTS).sort();
    expect([...SHOP_CATEGORY_ORDER].sort()).toEqual(server);
    expect(Object.keys(SHOP_CATEGORY_LABEL).sort()).toEqual(server);
  });

  it("keep other as the last stop of the walk", () => {
    expect(SHOP_CATEGORY_ORDER.at(-1)).toBe("other");
  });
});

/**
 * The shopping-list judgement has the same split: the function enforces the
 * due rule and the threshold, the client applies them to decide when to call
 * and what to offer. A drift here is either calls the function refuses, or a
 * list the function calls a shopping list that the app still hides aisles on.
 */
describe("shopping-list judgement: function vs client", () => {
  it("agree on the threshold and on when a list is due", () => {
    expect(clientThreshold).toBe(serverThreshold);
    expect(clientMinItems).toBe(serverMinItems);
    for (const checked of [null, 1, 2, 3, 4, 8, 16]) {
      for (let count = 0; count <= 40; count++) {
        expect(clientShouldCheck(count, checked)).toBe(serverShouldCheck(count, checked));
      }
    }
  });
});
