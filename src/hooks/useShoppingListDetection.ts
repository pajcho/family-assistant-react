import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/hooks/useProfile";
import { TEMP_TASK_ID_PREFIX } from "@/hooks/useTasks";
import { supabase } from "@/lib/supabase";
import { SHOPPING_LIST_THRESHOLD, shouldCheckShoppingList } from "@/lib/shopCategories";
import type { ListWithTasks } from "@/types/database";

/**
 * (list id, item count) pairs already asked about this session. Module-level so
 * it survives remounts and StrictMode's double effects.
 */
const asked = new Set<string>();

/**
 * Asks whether a list is a shopping list once it has grown enough, so "Po
 * rafovima" can be offered and suggested whatever the list is called.
 *
 * Fires only when the list GROWS while it is open, i.e. somebody just added an
 * item, and never on a mere visit: a list the family only reads, a loan ledger
 * say, is not sent to the model until somebody writes to it. The due rule (two
 * items, then each time the list doubles) runs here to skip pointless calls and
 * again in the function, which is the real guard.
 *
 * Fire-and-forget and silent, like useAutoCategorize: the answer lands as a list
 * update over realtime, and a model that is down simply means no suggestion.
 *
 * Mount once per open list (useSmartSort does).
 */
export function useShoppingListDetection(list: ListWithTasks): void {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  // Placeholders are not in the database yet; the real row is what counts.
  const itemCount = list.tasks.filter((task) => !task.id.startsWith(TEMP_TASK_ID_PREFIX)).length;
  const settled =
    list.smart_sort_enabled || (list.shopping_likelihood ?? 0) >= SHOPPING_LIST_THRESHOLD;
  const checkedItems = list.shopping_checked_items;
  const listId = list.id;

  // Where this list stood on the previous render. Keyed by id because the same
  // screen can move to another list without remounting, and comparing one
  // list's count with another's would read as growth.
  const previous = useRef<{ listId: string; count: number } | null>(null);

  useEffect(() => {
    const last = previous.current;
    previous.current = { listId, count: itemCount };
    if (!last || last.listId !== listId || itemCount <= last.count) return;
    if (settled || !shouldCheckShoppingList(itemCount, checkedItems)) return;

    const key = `${listId}\u0000${itemCount}`;
    if (asked.has(key)) return;
    asked.add(key);

    void supabase.functions
      .invoke<{ checked?: boolean }>("detect-shopping-list", { body: { list_id: listId } })
      .then(({ data, error }) => {
        // Realtime delivers the same change; this covers a dropped socket.
        if (!error && data?.checked) {
          void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
        }
      })
      .catch(() => {
        // Silent by design: see the hook note.
      });
  }, [itemCount, settled, checkedItems, listId, familyId, queryClient]);
}
