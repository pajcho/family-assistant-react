import { describe, expect, it } from "vitest";

import { orderLists } from "@/components/tasks/listOrder";

/**
 * The one display order the grid, the sidebar and the desktop pane resolver all
 * read. Two tiers: what THIS device opened, in the order it opened them, then
 * everything else by family activity.
 *
 * Imports the pure module - it reaches localStorage at most, never
 * `lib/supabase`, and CI has no Supabase env.
 */

const LISTS = [
  { id: "old", updated_at: "2026-01-01T00:00:00Z" },
  { id: "shop", updated_at: "2026-02-01T00:00:00Z" },
  { id: "chores", updated_at: "2026-03-01T00:00:00Z" },
];

const ids = (lists: ReadonlyArray<{ id: string }>) => lists.map((list) => list.id);

describe("orderLists", () => {
  it("puts recently opened lists first, in the order they were opened", () => {
    expect(ids(orderLists(LISTS, ["shop", "old"]))).toEqual(["shop", "old", "chores"]);
  });

  it("falls back to newest family activity for everything else", () => {
    // No personal history at all - which is a fresh device, not an error.
    expect(ids(orderLists(LISTS, []))).toEqual(["chores", "shop", "old"]);
  });

  it("beats recency with history, because the bump may be somebody else's", () => {
    // `chores` was touched most recently by the family; `old` is the one I keep
    // opening. Mine wins.
    expect(ids(orderLists(LISTS, ["old"]))).toEqual(["old", "chores", "shop"]);
  });

  it("ignores remembered ids that no longer exist", () => {
    expect(ids(orderLists(LISTS, ["deleted", "shop"]))).toEqual(["shop", "chores", "old"]);
  });

  it("is a permutation - nothing dropped, nothing duplicated", () => {
    const out = orderLists(LISTS, ["shop", "deleted", "old", "shop"]);
    expect(out).toHaveLength(LISTS.length);
    expect([...ids(out)].sort()).toEqual([...ids(LISTS)].sort());
  });

  it("handles an empty roster", () => {
    expect(orderLists([], ["shop"])).toEqual([]);
  });
});
