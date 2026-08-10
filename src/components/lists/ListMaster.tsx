import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  UserGroupIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { IconButton } from "@/components/common/IconButton";
import {
  ItemCard,
  ItemMain,
  ItemMeta,
  ItemSide,
  ItemTile,
  ItemTitle,
} from "@/components/common/ItemCard";
import { Pill } from "@/components/common/Pill";
import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { previewLine } from "@/components/common/MarkdownText";
import { ListFormDialog } from "@/components/lists/ListFormDialog";
import type { ListFormPayload } from "@/components/lists/ListForm";
import { useCreateList, useListsWithItems } from "@/hooks/useLists";
import { cn } from "@/lib/cn";
import type { ListScope, ListWithItems } from "@/types/database";

type MasterVariant = "sidebar" | "page";

/** Quick scope filter shown above the rows. "all" disables the filter. */
type ScopeFilter = "all" | ListScope;

const SCOPE_FILTERS: Array<{ value: ScopeFilter; label: string }> = [
  { value: "all", label: "Sve" },
  { value: "family", label: "Porodične" },
  { value: "personal", label: "Lične" },
];

export type ListMasterProps = {
  /**
   * `sidebar` = desktop left panel: fills its parent's height, scrolls
   * internally, and highlights the currently-open list. `page` = mobile
   * full-screen: normal page flow, each row deep-links into the detail page.
   *
   * The component is only ever mounted at one breakpoint per surface (the
   * shell renders the sidebar at ≥lg, the index route renders the page below
   * lg), so the variant is passed explicitly rather than inferred responsively.
   */
  variant: MasterVariant;
};

/**
 * Master list of all lists - the left pane of the Apple Notes-style
 * master-detail layout on desktop, and the full-screen list on mobile.
 *
 * Owns only *create* (the `+`) and *selection*. Per-list actions (edit,
 * duplicate, delete, export…) live in the detail pane's header - you act on
 * the open list, the same way Apple Notes acts on the open note.
 *
 * Reads the shared `useListsWithItems()` cache directly (no props) so it stays
 * in sync with the detail pane and the dashboard without any plumbing.
 */
export function ListMaster({ variant }: ListMasterProps) {
  const listsQuery = useListsWithItems();
  const createList = useCreateList();

  const lists = useMemo<ListWithItems[]>(() => listsQuery.data ?? [], [listsQuery.data]);

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");

  // Newest-first by creation. The shared query is `updated_at` desc (the
  // dashboard wants recently-used on top); the master keeps the old /lists
  // "creation order" by re-sorting client-side. `created_at` is an ISO string,
  // so a descending string compare is chronological.
  const sortedLists = useMemo(
    () => [...lists].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [lists],
  );

  // Scope chip + case-insensitive substring search over name + description.
  // Lists are already in memory, so we filter on every keystroke, no debounce.
  const filteredLists = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sortedLists.filter((list) => {
      if (scopeFilter !== "all" && list.scope !== scopeFilter) return false;
      if (query) {
        const haystack = `${list.name} ${list.description ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [sortedLists, scopeFilter, search]);

  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Starter-chip prefill (the chips on the empty state).
  const [addInitialName, setAddInitialName] = useState<string | null>(null);

  const openAdd = () => {
    setFormError(null);
    setAddInitialName(null);
    setFormOpen(true);
  };

  const openAddWithName = (name: string) => {
    setFormError(null);
    setAddInitialName(name);
    setFormOpen(true);
  };

  // Dashboard "Dodaj → Lista" deep-link (`/lists?new=1`): open the create
  // dialog, then strip the param so it won't reopen on a re-render or back
  // navigation - same pattern as `?edit=` on /activities. The param lives on
  // the layout route, so this fires for whichever variant is mounted (sidebar
  // on desktop, page on mobile). `to: "."` keeps the strip on the current
  // URL even if the desktop index has already redirected to /lists/$listId.
  const { new: openNew } = useSearch({ from: "/_app/lists" });
  const navigate = useNavigate();
  useEffect(() => {
    if (!openNew) return;
    setFormError(null);
    setFormOpen(true);
    void navigate({ to: ".", search: (prev) => ({ ...prev, new: undefined }), replace: true });
  }, [openNew, navigate]);

  const handleFormSubmit = async (payload: ListFormPayload) => {
    setFormError(null);
    try {
      await createList.mutateAsync(payload);
      setFormOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error && err.message ? err.message : "Greška pri kreiranju liste",
      );
    }
  };

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setFormError(null);
      setAddInitialName(null);
    }
  };

  const clearFilters = () => {
    setScopeFilter("all");
    setSearch("");
  };

  const isLoading = listsQuery.isLoading;
  const showEmpty = !isLoading && lists.length === 0;
  const showNoMatches = !isLoading && lists.length > 0 && filteredLists.length === 0;
  const showFilters = !isLoading && lists.length > 1;

  const isSidebar = variant === "sidebar";

  const dialog = (
    <ListFormDialog
      open={formOpen}
      onOpenChange={handleFormOpenChange}
      list={null}
      mode="create"
      initialName={addInitialName ?? undefined}
      error={formError}
      saving={createList.isPending}
      onSubmit={(payload) => {
        void handleFormSubmit(payload);
      }}
    />
  );

  const filterBar = (
    <div className={cn("flex flex-col gap-2", isSidebar ? "" : "sm:flex-row sm:items-center")}>
      <FilterChipRow ariaLabel="Pristup">
        {SCOPE_FILTERS.map((filter) => (
          <FilterChip
            key={filter.value}
            active={scopeFilter === filter.value}
            onToggle={() => setScopeFilter(filter.value)}
          >
            {filter.label}
          </FilterChip>
        ))}
      </FilterChipRow>
      <div className={cn("relative", isSidebar ? "w-full" : "w-full sm:max-w-xs")}>
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pretraži liste…"
          aria-label="Pretraži liste"
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
  );

  const rows = filteredLists.map((list) => (
    <ListMasterRow key={list.id} list={list} variant={variant} />
  ));

  // ---- Desktop sidebar: fixed header + filters, scrollable row region ----
  if (isSidebar) {
    return (
      <div className="flex h-full flex-col bg-card">
        <div className="shrink-0 border-b border-border px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Liste</h2>
            <Button size="icon-sm" variant="ghost" onClick={openAdd} aria-label="Dodaj listu">
              <PlusIcon className="h-5 w-5" />
            </Button>
          </div>
          {showFilters ? <div className="mt-3">{filterBar}</div> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <ListMasterSkeleton variant="sidebar" />
          ) : showEmpty ? (
            <div className="px-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">Još nemaš nijednu listu.</p>
              <Button onClick={openAdd} size="sm" className="mt-3">
                <PlusIcon className="mr-1.5 h-4 w-4" />
                Dodaj listu
              </Button>
            </div>
          ) : showNoMatches ? (
            <div className="px-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">Nema rezultata.</p>
              <Button variant="outline" size="sm" onClick={clearFilters} className="mt-3">
                Poništi filtere
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5">{rows}</div>
          )}
        </div>
        {dialog}
      </div>
    );
  }

  // ---- Mobile page: normal flow, deep-links into the detail page ----
  const header = (
    <div className="flex flex-col gap-2.5">
      <ScreenHeaderRow
        title="Liste"
        actions={
          <>
            <IconButton icon={PlusIcon} aria-label="Dodaj listu" onClick={openAdd} />
          </>
        }
      />
      {showFilters ? filterBar : null}
    </div>
  );

  return (
    <AppScreen header={header}>
      {isLoading ? <ListMasterSkeleton variant="page" /> : null}

      {showEmpty ? (
        <EmptyState
          icon={ClipboardDocumentListIcon}
          tone="purple"
          title="Još nemaš nijednu listu"
          description={
            'Napravi prvu listu - npr. „Šoping" deljenu sa porodicom ili „Lične obaveze".'
          }
          action={{ label: "Dodaj prvu listu", onClick: openAdd }}
          examples={["Šoping", "Obaveze"].map((name) => ({
            label: name,
            onClick: () => openAddWithName(name),
          }))}
        />
      ) : null}

      {showNoMatches ? (
        <EmptyState
          variant="filter"
          title="Nijedna lista ne odgovara filteru"
          description="Probaj drugačiju pretragu ili promeni filter pristupa."
          secondaryAction={{ label: "Poništi filtere", onClick: clearFilters }}
        />
      ) : null}

      {!isLoading && filteredLists.length > 0 ? (
        <>
          <ul className="space-y-2.5">{rows}</ul>
          <p className="mt-4 px-5 text-center text-[11.5px] font-normal text-muted-foreground">
            Porodične liste vide svi članovi u realnom vremenu.
          </p>
        </>
      ) : null}

      {dialog}
    </AppScreen>
  );
}

/**
 * Row-shaped loading placeholder matching `ListMasterRow`'s two variants -
 * name line + right-aligned count - so the pane doesn't jump when the lists
 * arrive.
 */
function ListMasterSkeleton({ variant }: { variant: MasterVariant }) {
  const widths = ["w-2/5", "w-3/5", "w-1/2", "w-2/5"] as const;

  if (variant === "sidebar") {
    return (
      <div role="status" aria-busy="true" className="space-y-0.5">
        <span className="sr-only">Učitavanje</span>
        {widths.map((width, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <Skeleton className={cn("h-4", width)} />
            </span>
            <Skeleton className="h-3 w-4 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="status" aria-busy="true" className="space-y-2.5">
      <span className="sr-only">Učitavanje</span>
      {widths.map((width, i) => (
        <div
          key={i}
          className="flex items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3"
        >
          <Skeleton className="size-[42px] shrink-0 rounded-lg" />
          <span className="min-w-0 flex-1">
            <Skeleton className={cn("h-4", width)} />
          </span>
          <Skeleton className="h-4 w-5 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ListMasterRow({ list, variant }: { list: ListWithItems; variant: MasterVariant }) {
  const active = list.list_items.filter((i) => !i.is_completed).length;
  const completed = list.list_items.length - active;
  const isFamily = list.scope === "family";

  if (variant === "sidebar") {
    return (
      <Link
        to="/lists/$listId"
        params={{ listId: list.id }}
        activeOptions={{ exact: true }}
        className="block rounded-md px-3 py-2 transition-colors"
        activeProps={{ className: "bg-accent-soft" }}
        inactiveProps={{ className: "hover:bg-muted" }}
      >
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-semibold">{list.name}</span>
            {isFamily ? (
              <UserGroupIcon
                className="h-3.5 w-3.5 shrink-0 text-accent-deep"
                aria-label="Porodična lista"
              />
            ) : null}
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
            {active}
          </span>
        </div>
        {list.description && previewLine(list.description) ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {previewLine(list.description)}
          </p>
        ) : null}
      </Link>
    );
  }

  const meta = [
    `${active} ${active === 1 ? "aktivna" : "aktivnih"}`,
    completed > 0 ? `${completed} završeno` : null,
    list.description ? previewLine(list.description) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <Link to="/lists/$listId" params={{ listId: list.id }} className="block">
        <ItemCard>
          <ItemTile icon={isFamily ? UserGroupIcon : UserIcon} tone="accent" />
          <ItemMain>
            <ItemTitle>
              <span className="min-w-0 truncate">{list.name}</span>
              {isFamily ? <Pill>porodična</Pill> : null}
            </ItemTitle>
            {meta ? (
              <ItemMeta>
                <span className="min-w-0 truncate">{meta}</span>
              </ItemMeta>
            ) : null}
          </ItemMain>
          <ItemSide>
            <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          </ItemSide>
        </ItemCard>
      </Link>
    </li>
  );
}
