import { useEffect, useRef, useState } from "react";

import { readRecentListIds } from "@/lib/recentLists";

/**
 * One display order for the lists, shared by the three surfaces that show them
 * (the mobile grid, the desktop sidebar and the desktop pane resolver) so they
 * can never drift apart.
 *
 * The order is "what I use", in two tiers: the lists THIS device opened, in the
 * order it opened them, then everything else by `updated_at` - which the
 * database keeps fresh through an AFTER trigger on `tasks`, so a list somebody
 * added to today outranks one nobody has touched since spring.
 *
 * The two tiers exist because neither signal is enough alone. `updated_at` is
 * family-wide, so on its own your grid reshuffles whenever somebody else ticks
 * something off. The device's own history is personal but goes cold for a list
 * you have never opened on this phone. Together: yours first, then the
 * household's.
 *
 * Pure and free of any import chain reaching `lib/supabase` (`recentLists` is
 * localStorage only) - CI has no Supabase env.
 */

export interface OrderableList {
  id: string;
  updated_at: string;
}

/** Recently opened on this device first, then the rest, newest activity first. */
export function orderLists<T extends OrderableList>(
  lists: readonly T[],
  recentIds: readonly string[],
): T[] {
  const rank = new Map(recentIds.map((id, index) => [id, index]));
  const recent: T[] = [];
  const rest: T[] = [];
  for (const list of lists) {
    if (rank.has(list.id)) recent.push(list);
    else rest.push(list);
  }
  // Non-null: `rank.has` is what put these here.
  recent.sort((a, b) => (rank.get(a.id) as number) - (rank.get(b.id) as number));
  rest.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return [...recent, ...rest];
}

/**
 * {@link orderLists} against this device's history, recomputed on every render.
 * What the mobile grid uses: you leave that screen to touch a list, so any
 * reshuffle happens off-screen.
 */
export function useListOrder<T extends OrderableList>(lists: readonly T[]): T[] {
  return orderLists(lists, readRecentListIds());
}

/**
 * The same order, but frozen while the surface stays mounted.
 *
 * The desktop sidebar sits beside the pane you are working in, so an order that
 * recomputed live would slide the row out from under the pointer the moment you
 * clicked it (opening a list promotes it) or ticked a task in it (that bumps
 * `updated_at`). It re-sorts when the SET of lists changes - one was created,
 * renamed away or deleted - which is the only time the order is actually stale.
 */
export function useStableListOrder<T extends OrderableList>(lists: readonly T[]): T[] {
  const [order, setOrder] = useState<string[]>(() =>
    orderLists(lists, readRecentListIds()).map((l) => l.id),
  );
  const signature = lists
    .map((list) => list.id)
    .sort()
    .join("|");
  const lastSignature = useRef(signature);

  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setOrder(orderLists(lists, readRecentListIds()).map((l) => l.id));
    // `lists` is read through the signature, which is what decides staleness.
  }, [signature, lists]);

  const byId = new Map(lists.map((list) => [list.id, list]));
  const held = order.map((id) => byId.get(id)).filter((list): list is T => list !== undefined);
  // Anything the frozen order has not heard of yet (first paint after a create)
  // goes on the end rather than waiting a render to appear at all.
  const seen = new Set(held.map((list) => list.id));
  return [...held, ...lists.filter((list) => !seen.has(list.id))];
}
