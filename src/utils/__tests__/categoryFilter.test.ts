import { describe, expect, it } from "vitest";

import { UNCATEGORIZED, matchesCategoryFilter, toggleInSet } from "@/utils/categoryFilter";

describe("matchesCategoryFilter", () => {
  it("passes everything when nothing is selected", () => {
    const none = new Set<string>();
    expect(matchesCategoryFilter("cat-1", none)).toBe(true);
    expect(matchesCategoryFilter(null, none)).toBe(true);
  });

  it("narrows to the selected categories", () => {
    const selected = new Set(["cat-1", "cat-2"]);
    expect(matchesCategoryFilter("cat-1", selected)).toBe(true);
    expect(matchesCategoryFilter("cat-3", selected)).toBe(false);
  });

  // "What did I forget to classify" is half of why this filter exists, so an
  // uncategorized row must be reachable - and must NOT leak into a selection
  // that only names real categories.
  it("treats uncategorized rows as their own bucket", () => {
    expect(matchesCategoryFilter(null, new Set([UNCATEGORIZED]))).toBe(true);
    expect(matchesCategoryFilter(null, new Set(["cat-1"]))).toBe(false);
    expect(matchesCategoryFilter("cat-1", new Set([UNCATEGORIZED]))).toBe(false);
  });

  it("combines the uncategorized bucket with real categories", () => {
    const selected = new Set([UNCATEGORIZED, "cat-1"]);
    expect(matchesCategoryFilter(null, selected)).toBe(true);
    expect(matchesCategoryFilter("cat-1", selected)).toBe(true);
    expect(matchesCategoryFilter("cat-2", selected)).toBe(false);
  });
});

describe("toggleInSet", () => {
  it("adds, removes and never mutates the input", () => {
    const start: ReadonlySet<string> = new Set(["a"]);
    const added = toggleInSet(start, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...start]).toEqual(["a"]);

    const removed = toggleInSet(added, "a");
    expect([...removed]).toEqual(["b"]);
  });

  it("empties back to the no-filter state", () => {
    expect(toggleInSet(new Set(["a"]), "a").size).toBe(0);
  });
});
