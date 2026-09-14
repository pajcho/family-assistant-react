import type { SearchResult, SearchResultKind } from "@/hooks/useGlobalSearch";

/**
 * What tapping a row in the global search palette does.
 *
 * One rule decides every arm: **a search hit never opens an edit form.**
 * Searching is a "find me this thing" gesture, not "let me change it", so an
 * entity hit lands on the SAME detail sheet its own page opens, where "Izmeni"
 * is one visible row among the others. The palette used to drop straight into
 * the edit form for activities, events, payments and birthdays, which meant
 * looking something up put the user one stray keystroke away from changing it.
 *
 * The two navigating arms are not exceptions to that rule - neither of them is
 * an edit form either. A page IS a destination, and so is a list: `/tasks/:id`
 * is where a list lives, there is no "list sheet" to open instead.
 *
 * Pure on purpose, and free of any Supabase-touching import, so the routing
 * table is unit testable the way `searchPages.ts` is - `SearchResult` comes in
 * as a type only, which the compiler erases.
 */

/** Entity kinds that open a detail sheet in place. */
export type SearchDetailKind = Exclude<SearchResultKind, "page" | "list">;

/** The entity a detail sheet is opened for. */
export type SearchDetailTarget = {
  kind: SearchDetailKind;
  id: string;
};

export type SearchAction =
  /** A nav section - `id` is its `SEARCH_PAGES` key. */
  | { type: "page"; pageId: string }
  /** A task list - `/tasks/$listId`. */
  | { type: "list"; listId: string }
  | { type: "detail"; target: SearchDetailTarget };

export function searchResultAction(result: SearchResult): SearchAction {
  switch (result.kind) {
    case "page":
      return { type: "page", pageId: result.id };
    case "list":
      return { type: "list", listId: result.id };
    default:
      return { type: "detail", target: { kind: result.kind, id: result.id } };
  }
}
