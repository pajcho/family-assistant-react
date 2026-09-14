import { describe, expect, it } from "vitest";

import { searchResultAction } from "@/components/search/searchResultAction";
import type { SearchResult, SearchResultKind } from "@/hooks/useGlobalSearch";

/**
 * Pins the one promise the palette makes: a search hit shows you the thing, it
 * never opens a form over it.
 *
 * The kind list is `satisfies Record<SearchResultKind, ...>`, so adding a
 * searchable entity without saying what tapping it does fails to compile here
 * rather than shipping a row that silently inherits an arm.
 */

const EXPECTED: Record<SearchResultKind, "detail" | "page" | "list"> = {
  // Used to open their EDIT form straight from the palette.
  activity: "detail",
  event: "detail",
  payment: "detail",
  birthday: "detail",
  // Used to navigate away: the task to its parent list, a mirrored Google event
  // to the calendar - neither of which showed you the row you had just found.
  task: "detail",
  external: "detail",
  // The two that ARE destinations rather than things.
  page: "page",
  list: "list",
};

function hit(kind: SearchResultKind, id = "id-1"): SearchResult {
  return { kind, id, title: "Struja", subtitle: null };
}

describe("searchResultAction", () => {
  it("opens a detail sheet for every entity kind", () => {
    for (const kind of Object.keys(EXPECTED) as SearchResultKind[]) {
      if (EXPECTED[kind] !== "detail") continue;
      expect(searchResultAction(hit(kind))).toEqual({
        type: "detail",
        target: { kind, id: "id-1" },
      });
    }
  });

  it("navigates for the two kinds that are destinations", () => {
    expect(searchResultAction(hit("page", "school"))).toEqual({ type: "page", pageId: "school" });
    expect(searchResultAction(hit("list", "list-7"))).toEqual({ type: "list", listId: "list-7" });
  });

  it("gives every searchable kind the action the table says", () => {
    for (const kind of Object.keys(EXPECTED) as SearchResultKind[]) {
      expect(searchResultAction(hit(kind)).type).toBe(EXPECTED[kind]);
    }
  });
});
