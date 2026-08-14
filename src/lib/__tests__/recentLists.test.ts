import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pushRecentListId, readLastOpenedListId, readRecentListIds } from "@/lib/recentLists";

/**
 * Per-device memory of the lists this person uses. Every path here is a
 * degradation path: private mode throws, an older build wrote a different key,
 * and a hand-edited value can be anything at all. None of them may throw at a
 * caller, because all three readers are on a render path.
 */

const KEY = "lists.recentIds.v1";
const LEGACY_KEY = "lists.lastOpenedId.v1";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recentLists", () => {
  it("remembers most-recently-used first", () => {
    pushRecentListId("a");
    pushRecentListId("b");
    expect(readRecentListIds()).toEqual(["b", "a"]);
    expect(readLastOpenedListId()).toBe("b");
  });

  it("moves a repeat to the front instead of duplicating it", () => {
    pushRecentListId("a");
    pushRecentListId("b");
    pushRecentListId("a");
    expect(readRecentListIds()).toEqual(["a", "b"]);
  });

  it("caps the memory", () => {
    for (let i = 0; i < 12; i++) pushRecentListId(`list-${i}`);
    const stored = readRecentListIds();
    expect(stored).toHaveLength(8);
    expect(stored[0]).toBe("list-11");
  });

  it("seeds from the single-id key the old build wrote", () => {
    window.localStorage.setItem(LEGACY_KEY, "from-before");
    expect(readRecentListIds()).toEqual(["from-before"]);
    expect(readLastOpenedListId()).toBe("from-before");
  });

  it("carries the seeded id forward instead of dropping it on the first write", () => {
    window.localStorage.setItem(LEGACY_KEY, "from-before");
    pushRecentListId("newer");
    expect(readRecentListIds()).toEqual(["newer", "from-before"]);
    // And the legacy key stops mattering from here on.
    window.localStorage.setItem(LEGACY_KEY, "ignored-now");
    expect(readRecentListIds()).toEqual(["newer", "from-before"]);
  });

  it("treats a corrupt value as no memory", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readRecentListIds()).toEqual([]);
    window.localStorage.setItem(KEY, '{"id":"a"}');
    expect(readRecentListIds()).toEqual([]);
    window.localStorage.setItem(KEY, '["a", 3, null, "b"]');
    expect(readRecentListIds()).toEqual(["a", "b"]);
  });

  it("degrades to no memory when storage throws (private mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readRecentListIds()).toEqual([]);
    expect(readLastOpenedListId()).toBeNull();
    expect(() => pushRecentListId("a")).not.toThrow();
  });

  it("ignores an empty id", () => {
    pushRecentListId("");
    expect(readRecentListIds()).toEqual([]);
  });
});
