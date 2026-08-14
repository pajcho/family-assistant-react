import type { ReactNode } from "react";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClipboardDocumentCheckIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { TasksIndexScreen, type TasksTab } from "@/components/tasks/TasksIndexScreen";
import type { SmartListKey } from "@/components/tasks/smartLists";
import { useIsWide } from "@/hooks/useIsWide";
import { useListsWithTasks } from "@/hooks/useTasks";
import { orderLists } from "@/components/tasks/listOrder";
import { readLastOpenedListId, readRecentListIds } from "@/lib/recentLists";
import type { ListWithTasks } from "@/types/database";

export const Route = createFileRoute("/_app/tasks/")({
  // `?tab=lists` opens the overview on its lists half. A search param rather
  // than component state so it is linkable (the Meni can point straight at the
  // lists) and survives back/forward. Same shape as `/money?tab=` and
  // `/calendar?view=`: a FRESH result object, never a spread of the raw search,
  // or omitting `tab` would leak an unvalidated value through.
  // `?cut=` is the same idea one level in: which of the four cross-list views
  // the tiles have swapped into the Zadaci half. Absent means the default -
  // what is late, today and tomorrow.
  validateSearch: (search: Record<string, unknown>): { tab?: TasksTab; cut?: SmartListKey } => {
    const tab = search.tab;
    const cut = search.cut;
    return {
      ...(tab === "lists" || tab === "tasks" ? { tab } : {}),
      ...(cut === "late" || cut === "scheduled" || cut === "inbox" || cut === "done"
        ? { cut }
        : {}),
    };
  },
  component: TasksIndex,
});

/**
 * `/tasks` - a different screen per breakpoint.
 *
 * Mobile (< lg): the Zadaci overview, full-screen. Late and today's work on top,
 * tickable in place, then the lists as a grid.
 *
 * Desktop (>= lg): the overview's job is already done by the persistent sidebar
 * in `_app.tasks.tsx`, so this route only decides which pane to open on the right
 * - last-opened list (if it still exists) → first list → Zakazano when there are
 * no lists at all but there may still be dated or listless tasks. Selection is
 * URL-driven, so deep-links, back/forward and the dashboard all land right.
 *
 * `useIsWide` + `useListsWithTasks` are called unconditionally at the top to
 * satisfy the rules of hooks before any branch.
 */
function TasksIndex() {
  const isWide = useIsWide();
  const listsQuery = useListsWithTasks();
  const { tab, cut } = Route.useSearch();
  const navigate = useNavigate();

  if (!isWide) {
    return (
      <TasksIndexScreen
        tab={tab ?? "tasks"}
        onTabChange={(next) => {
          void navigate({
            to: "/tasks",
            // Leaving the Zadaci half drops the cut with it - it belongs to that
            // half, and coming back to a view you cannot see the tiles for reads
            // as the screen having remembered the wrong thing.
            // Built explicitly, never spread from `prev`: the reducer sees the
            // union of EVERY route's params, so `...prev` drags `/money`'s and
            // `/calendar`'s `tab` values into this route's type.
            search: (prev) => ({
              new: prev.new,
              tab: next === "tasks" ? undefined : next,
              cut: next === "tasks" ? prev.cut : undefined,
            }),
            replace: true,
          });
        }}
        cut={cut ?? null}
        onCutChange={(next) => {
          void navigate({
            to: "/tasks",
            // `tab` from the route's OWN validated search, not from `prev`,
            // which is the union of every route's params.
            search: (prev) => ({ new: prev.new, tab, cut: next ?? undefined }),
            replace: true,
          });
        }}
      />
    );
  }

  // Wait for data before resolving so we never redirect to a stale id.
  if (listsQuery.isPending) {
    return <DetailPlaceholder>Učitavanje…</DetailPlaceholder>;
  }

  const target = resolveInitialList(listsQuery.data ?? []);
  if (target) {
    return <Navigate to="/tasks/$listId" params={{ listId: target }} replace />;
  }

  // No lists at all. Zakazano is still a real screen - a task does not need a
  // list - so the pane opens there instead of on a dead end, and the pitch for a
  // first list lives on the placeholder below it.
  return (
    <DetailPlaceholder>
      <span className="block text-base font-semibold text-foreground">Još nemaš nijednu listu</span>
      <span className="mt-1 block">
        Napravi prvu listu - npr. „Šoping" koju vidi cela porodica ili „Obaveze" samo za tebe.
      </span>
      <span className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link to="/tasks" search={{ new: true }}>
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj prvu listu
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/tasks/scheduled">Pogledaj zakazano</Link>
        </Button>
      </span>
    </DetailPlaceholder>
  );
}

/**
 * Pick the list to open on a bare `/tasks` desktop visit: the last-opened list if
 * it still exists, otherwise the first in the sidebar's display order, so the
 * pane and the sidebar always agree on what "first" means.
 */
function resolveInitialList(lists: ListWithTasks[]): string | null {
  if (lists.length === 0) return null;
  const lastId = readLastOpenedListId();
  if (lastId && lists.some((l) => l.id === lastId)) return lastId;
  return orderLists(lists, readRecentListIds())[0]?.id ?? null;
}

function DetailPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <ClipboardDocumentCheckIcon className="h-10 w-10 text-muted-foreground/50" />
      <p className="mt-3 max-w-xs text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
