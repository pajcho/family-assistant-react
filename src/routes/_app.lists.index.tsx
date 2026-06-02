import type { ReactNode } from "react";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { ClipboardDocumentListIcon } from "@heroicons/react/24/outline";

import { ListMaster } from "@/components/lists/ListMaster";
import { useIsWide } from "@/hooks/useIsWide";
import { useListsWithItems } from "@/hooks/useLists";
import { readLastOpenedListId } from "@/lib/lastOpenedList";
import type { ListWithItems } from "@/types/database";

export const Route = createFileRoute("/_app/lists/")({
  component: ListsIndex,
});

/**
 * `/lists` — behaves differently per breakpoint:
 *
 * Mobile (< lg): this route IS the master list, full-screen. Tapping a row
 * deep-links to the detail page.
 *
 * Desktop (>= lg): the master already lives in the persistent shell sidebar
 * (`_app.lists.tsx`), so this route's only job is to decide which list to open
 * and redirect there — last-opened (if it still exists) → first list →
 * (no lists) a placeholder. Selection is URL-driven, so deep-links,
 * back/forward and the dashboard all land on the right list.
 *
 * `useIsWide` + `useListsWithItems` are called unconditionally at the top to
 * satisfy the rules of hooks before any branch.
 */
function ListsIndex() {
  const isWide = useIsWide();
  const listsQuery = useListsWithItems();

  if (!isWide) {
    return <ListMaster variant="page" />;
  }

  // Wait for data before resolving so we never redirect to a stale id.
  if (listsQuery.isPending) {
    return <DetailPlaceholder>Učitavanje…</DetailPlaceholder>;
  }

  const target = resolveInitialList(listsQuery.data ?? []);
  if (target) {
    return <Navigate to="/lists/$listId" params={{ listId: target }} replace />;
  }

  return (
    <DetailPlaceholder>
      Izaberite listu sa leve strane ili napravite novu pomoću dugmeta „+".
    </DetailPlaceholder>
  );
}

/**
 * Pick the list to open on a bare `/lists` desktop visit: the last-opened list
 * if it still exists, otherwise the first list in the sidebar's display order
 * (newest-created first, matching `ListMaster`).
 */
function resolveInitialList(lists: ListWithItems[]): string | null {
  if (lists.length === 0) return null;
  const lastId = readLastOpenedListId();
  if (lastId && lists.some((l) => l.id === lastId)) return lastId;
  const [first] = [...lists].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return first?.id ?? null;
}

function DetailPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <ClipboardDocumentListIcon className="h-10 w-10 text-gray-300 dark:text-gray-600" />
      <p className="mt-3 max-w-xs text-sm text-gray-500 dark:text-gray-400">{children}</p>
    </div>
  );
}
