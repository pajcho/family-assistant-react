import type { ReactNode } from "react";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { ClipboardDocumentCheckIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { TasksIndexScreen } from "@/components/tasks/TasksIndexScreen";
import { useIsWide } from "@/hooks/useIsWide";
import { useListsWithTasks } from "@/hooks/useTasks";
import { readLastOpenedListId } from "@/lib/lastOpenedList";
import type { ListWithTasks } from "@/types/database";

export const Route = createFileRoute("/_app/tasks/")({
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

  if (!isWide) {
    return <TasksIndexScreen />;
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
 * it still exists, otherwise the first list in the sidebar's display order
 * (newest-created first, matching `TaskSidebar`).
 */
function resolveInitialList(lists: ListWithTasks[]): string | null {
  if (lists.length === 0) return null;
  const lastId = readLastOpenedListId();
  if (lastId && lists.some((l) => l.id === lastId)) return lastId;
  const [first] = [...lists].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return first?.id ?? null;
}

function DetailPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <ClipboardDocumentCheckIcon className="h-10 w-10 text-muted-foreground/50" />
      <p className="mt-3 max-w-xs text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
