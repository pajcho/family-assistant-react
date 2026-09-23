import { describe, expect, it } from "vitest";

import { SHOP_CATEGORY_HINTS } from "./shopCategories.ts";
import { SHOP_CATEGORY_LABEL, SHOP_CATEGORY_ORDER } from "@/lib/shopCategories";

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
