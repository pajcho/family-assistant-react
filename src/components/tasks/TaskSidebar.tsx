import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  UserGroupIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { previewLine } from "@/components/common/MarkdownText";
import { SMART_LISTS } from "@/components/tasks/smartLists";
import { useStableListOrder } from "@/components/tasks/listOrder";
import { useSmartListCounts } from "@/components/tasks/taskItems";
import { useCreateListFlow } from "@/components/tasks/useCreateListFlow";
import { useListsWithTasks } from "@/hooks/useTasks";
import { cn } from "@/lib/cn";
import type { ListWithTasks } from "@/types/database";

/**
 * The left pane of the desktop master-detail shell.
 *
 * The split itself is untouched - it is the best part of the old screen. What
 * changed is what the sidebar leads with: the four cross-list cuts and their
 * counts first, because they are the fastest place to notice that something is
 * late, then the lists, then the way to make another one.
 *
 * Scope stopped being a chip row (Sve / Porodične / Lične) and became the glyph
 * on each row, which is all it was ever telling you. Nobody filters lists by who
 * can see them; the row for "Lične obaveze" simply says so.
 */
/** Stable empty array - keeps the order hook's input identity quiet while loading. */
const EMPTY_LISTS: ListWithTasks[] = [];

export function TaskSidebar() {
  const listsQuery = useListsWithTasks();
  const counts = useSmartListCounts();
  const { openAdd, dialog } = useCreateListFlow();
  const [search, setSearch] = useState("");

  // Same order as the mobile grid - what this person uses first - but FROZEN
  // while the sidebar stays mounted. It sits beside the pane you work in, so a
  // live re-sort would slide the row out from under the pointer the moment you
  // clicked it or ticked something inside it. See `listOrder`.
  const lists = useStableListOrder<ListWithTasks>(listsQuery.data ?? EMPTY_LISTS);

  // Searches the tasks too, not only the list names - that is what the field
  // promises, and "where did I put that" is the question it exists for. Lists are
  // already in memory, so it filters on every keystroke with no debounce.
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return lists;
    return lists.filter((list) => {
      const haystack = [list.name, list.description ?? "", ...list.tasks.map((task) => task.name)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [lists, search]);

  // Two drawers, not one pile. The sidebar has no room for a scope chip row and
  // does not need one - it shows everything at once, so grouping alone gives
  // "mine" and "ours" their own places without asking for a tap. An empty group
  // renders nothing at all, heading included.
  const groups = useMemo(
    () =>
      [
        { key: "family", label: "Porodične", items: filtered.filter((l) => l.scope === "family") },
        {
          key: "personal",
          label: "Lične",
          items: filtered.filter((l) => l.scope === "personal"),
        },
      ].filter((group) => group.items.length > 0),
    [filtered],
  );

  const isLoading = listsQuery.isLoading;

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="shrink-0 border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Zadaci</h2>
          <Button size="icon-sm" variant="ghost" onClick={openAdd} aria-label="Dodaj listu">
            <PlusIcon className="h-5 w-5" />
          </Button>
        </div>
        <div className="relative mt-3">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pretraži zadatke…"
            aria-label="Pretraži zadatke"
            className="px-9"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Obriši pretragu"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <SidebarGroupLabel>Pregled</SidebarGroupLabel>
        <div className="space-y-0.5">
          {SMART_LISTS.filter((entry) => !entry.hideWhenEmpty || counts[entry.key] > 0).map(
            (entry) => (
              <Link
                key={entry.key}
                to={entry.to}
                activeOptions={{ exact: true }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors"
                activeProps={{ className: "bg-accent-soft text-accent-deep" }}
                inactiveProps={{ className: "hover:bg-muted" }}
              >
                <entry.icon
                  className={cn(
                    "size-4 shrink-0",
                    entry.key === "late" ? "text-neg" : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-semibold tabular-nums",
                    entry.key === "late" ? "text-neg" : "text-muted-foreground",
                  )}
                >
                  {counts[entry.key]}
                </span>
              </Link>
            ),
          )}
        </div>

        {isLoading ? (
          <>
            <SidebarGroupLabel>Liste</SidebarGroupLabel>
            <SidebarSkeleton />
          </>
        ) : (
          <div className="space-y-0.5">
            {groups.map((group) => (
              <div key={group.key} className="space-y-0.5">
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                {group.items.map((list) => (
                  <SidebarListRow key={list.id} list={list} />
                ))}
              </div>
            ))}
            {filtered.length === 0 ? (
              <>
                <SidebarGroupLabel>Liste</SidebarGroupLabel>
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {lists.length === 0 ? "Još nemaš nijednu listu." : "Nema rezultata."}
                </p>
              </>
            ) : null}
            <button
              type="button"
              onClick={openAdd}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-accent-deep transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <PlusIcon className="size-4 shrink-0" aria-hidden="true" />
              Nova lista
            </button>
          </div>
        )}
      </div>

      {dialog}
    </div>
  );
}

function SidebarGroupLabel({ children }: { children: string }) {
  return (
    <div className="px-[7px] pt-3 pb-1.5 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase first:pt-0">
      {children}
    </div>
  );
}

function SidebarListRow({ list }: { list: ListWithTasks }) {
  const active = list.tasks.filter((task) => !task.is_completed).length;
  const isFamily = list.scope === "family";
  const Glyph = isFamily ? UserGroupIcon : UserIcon;
  const preview = list.description ? previewLine(list.description) : null;

  return (
    <Link
      to="/tasks/$listId"
      params={{ listId: list.id }}
      activeOptions={{ exact: true }}
      className="block rounded-md px-3 py-2 transition-colors"
      activeProps={{ className: "bg-accent-soft" }}
      inactiveProps={{ className: "hover:bg-muted" }}
    >
      <div className="flex items-center gap-2">
        <Glyph
          className="size-4 shrink-0 text-muted-foreground"
          aria-label={isFamily ? "Porodična lista" : "Lična lista"}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{list.name}</span>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
          {active}
        </span>
      </div>
      {preview ? (
        <p className="mt-0.5 truncate pl-6 text-xs font-normal text-muted-foreground">{preview}</p>
      ) : null}
    </Link>
  );
}

function SidebarSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-0.5">
      <span className="sr-only">Učitavanje</span>
      {["w-2/5", "w-3/5", "w-1/2", "w-2/5"].map((width) => (
        <div key={width} className="flex items-center gap-2 px-3 py-2">
          <Skeleton className="size-4 shrink-0 rounded" />
          <span className="min-w-0 flex-1">
            <Skeleton className={cn("h-4", width)} />
          </span>
          <Skeleton className="h-3 w-4 shrink-0" />
        </div>
      ))}
    </div>
  );
}
