import { useMemo, useState } from "react";
import {
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { IconButton } from "@/components/common/IconButton";
import { MemberFilterChips } from "@/components/common/MemberFilterChips";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { Segmented, type SegmentedOption } from "@/components/common/Segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { ListGridCard, NewListRow } from "@/components/tasks/ListGridCard";
import { useListOrder } from "@/components/tasks/listOrder";
import { useTickedHereLinger } from "@/components/tasks/useTickedHereLinger";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { TaskRow } from "@/components/tasks/TaskRow";
import { TaskQuickAddFlow } from "@/components/tasks/TaskQuickAddFlow";
import { TaskStatStrip } from "@/components/tasks/TaskStatStrip";
import {
  detailSheetDates,
  isTaskAgendaItem,
  matchesPersonFilter,
  type TaskAgendaItem,
} from "@/components/tasks/taskItemModel";
import { useSmartListCounts, useTaskAgendaItems } from "@/components/tasks/taskItems";
import { useCreateListFlow } from "@/components/tasks/useCreateListFlow";
import { agendaItemKey } from "@/hooks/useAgenda";
import { useOverdueTasks } from "@/hooks/useOverdueTasks";
import { useSearchDialog } from "@/hooks/useSearchDialog";
import { useListsWithTasks, useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import { cn } from "@/lib/cn";
import { formatDate } from "@/utils/date";
import { shiftIsoByDays } from "@/utils/pickerGrid";
import type { ListWithTasks } from "@/types/database";

/**
 * /tasks below `lg` - the screen the bottom bar lands on.
 *
 * It is the old index inverted. The lists used to BE the screen: five names and
 * their counts, nothing actionable until you picked one, and no way to find out
 * that the boiler service call was six days late without opening the list it sat
 * in. So the late and today's work came to the surface, tickable in place.
 *
 * That inversion then buried the lists: with 10+ of them the grid started a full
 * screenful down, under three dated sections, in creation order. The two halves
 * are now two SEGMENTS instead of one column - the dated work still leads,
 * because a push about something late must not land on a grid of lists, but
 * "Liste" is one tap rather than two swipes, and each half carries its own
 * filter row.
 *
 * Two independent queries feed it, and that is deliberate: the lists grid renders
 * from the `lists` cache the moment it is warm while the dated sections fill in
 * behind it. A person arriving from the bottom bar sees their lists immediately
 * rather than a whole-screen spinner.
 */

/** Rows per section before "Prikaži još" - about a screenful on a phone. */
const SECTION_LIMIT = 5;

/** How many of a section's rows are still to do - what its heading counts. */
function openCount(items: readonly TaskAgendaItem[]): number {
  return items.filter((item) => !item.isDone).length;
}

/** Stable empty array - keeps `useListOrder`'s input identity quiet while loading. */
const EMPTY_LISTS: ListWithTasks[] = [];

export type TasksTab = "tasks" | "lists";

/** Which lists the grid shows. Transient, like every other filter on the app. */
type ScopeFilter = "all" | "family" | "personal";

const TAB_OPTIONS: ReadonlyArray<SegmentedOption<TasksTab>> = [
  { value: "tasks", label: "Zadaci" },
  { value: "lists", label: "Liste" },
];

export type TasksIndexScreenProps = {
  tab: TasksTab;
  onTabChange: (next: TasksTab) => void;
};

export function TasksIndexScreen({ tab, onTabChange }: TasksIndexScreenProps) {
  const today = useToday().str;
  const tomorrow = shiftIsoByDays(today, 1) ?? today;
  const weekEnd = shiftIsoByDays(today, 6) ?? today;

  const { openSearch } = useSearchDialog();
  const { openAdd, openAddWithName, dialog } = useCreateListFlow();

  const [personIds, setPersonIds] = useState<ReadonlySet<string>>(() => new Set());
  const [listScope, setListScope] = useState<ScopeFilter>("all");
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [openTask, setOpenTask] = useState<TaskAgendaItem | null>(null);

  const listsQuery = useListsWithTasks();
  // Ordered by what this person uses, not by when the list was made - see
  // `listOrder`. Recomputed per render on purpose: you leave this screen to
  // touch a list, so the reshuffle always happens off-screen.
  const lists = useListOrder<ListWithTasks>(listsQuery.data ?? EMPTY_LISTS);
  const familyLists = lists.filter((list) => list.scope === "family");
  const personalLists = lists.filter((list) => list.scope === "personal");
  const shownLists =
    listScope === "family" ? familyLists : listScope === "personal" ? personalLists : lists;

  const overdue = useOverdueTasks();
  const week = useTaskAgendaItems({ from: today, to: weekEnd, today });
  const counts = useSmartListCounts();
  const tasksQuery = useTasksList();

  // Same cached query the two hooks above read - no extra fetch. The linger
  // needs the LIVE row for a task that has left the sections.
  const tasksById = useMemo(
    () => new Map((tasksQuery.data ?? []).map((task) => [task.id, task])),
    [tasksQuery.data],
  );

  // An empty person set means "everybody", the same convention the dashboard and
  // the activities chips use. It narrows the dated sections; the lists grid is
  // left alone, because a list is a container and has no assignee to filter on.
  const lateItems = useMemo(
    () => overdue.items.filter(isTaskAgendaItem).filter((i) => matchesPersonFilter(i, personIds)),
    [overdue.items, personIds],
  );
  const weekItems = useMemo(
    () => week.items.filter((i) => matchesPersonFilter(i, personIds)),
    [week.items, personIds],
  );
  const todayItems = useMemo(
    () => weekItems.filter((item) => item.date === today),
    [weekItems, today],
  );
  const tomorrowItems = useMemo(
    () => weekItems.filter((item) => item.date === tomorrow),
    [weekItems, tomorrow],
  );

  // A row ticked here keeps its place, struck through, until you navigate away -
  // see `useTickedHereLinger`. Without it a tap in "Kasni" made the row vanish
  // mid-gesture with nothing left to tap if the tap was a mistake.
  const lingering = useTickedHereLinger(
    [...lateItems, ...weekItems],
    tasksById,
    overdue.isLoading || week.isLoading,
  );

  const sections = useMemo(
    () =>
      buildSections({
        today,
        tomorrow,
        lateItems: [...lateItems, ...lingering.filter((item) => item.date < today)],
        todayItems: [...todayItems, ...lingering.filter((item) => item.date === today)],
        tomorrowItems: [...tomorrowItems, ...lingering.filter((item) => item.date === tomorrow)],
      }),
    [today, tomorrow, lateItems, todayItems, tomorrowItems, lingering],
  );

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const datedLoading = overdue.isLoading || week.isLoading;
  const hasAnything = lists.length > 0 || week.items.length > 0 || overdue.items.length > 0;
  const showFirstRun = !listsQuery.isLoading && !datedLoading && !hasAnything;

  // The header holds the title and the segment, and nothing else. Each half's
  // filter row lives INSIDE its own tab, down in the scroll area: sticky chrome
  // on this app is fragile (window scroll + a sticky header on iOS), and a third
  // pinned row would cost a tenth of the screen on every phone. The filters are
  // set-and-forget anyway - scrolling past them is not a loss.
  const header = (
    <div className="flex flex-col gap-2.5">
      <ScreenHeaderRow
        title="Zadaci"
        actions={
          <>
            <IconButton icon={MagnifyingGlassIcon} aria-label="Pretraži" onClick={openSearch} />
            {/* The screen about tasks had no way to make one: the only entry was
                the "+" in the bottom bar, which is a different control in a
                different place and says nothing about where you are. It follows
                the tab, because "add" means a different thing on each half. */}
            <IconButton
              icon={PlusIcon}
              aria-label={tab === "lists" ? "Dodaj listu" : "Dodaj zadatak"}
              onClick={tab === "lists" ? openAdd : () => setAddTaskOpen(true)}
            />
          </>
        }
      />
      {showFirstRun ? null : (
        <Segmented options={TAB_OPTIONS} value={tab} onChange={onTabChange} ariaLabel="Prikaz" />
      )}
    </div>
  );

  const personRow = (
    <FilterChipRow ariaLabel="Osoba" className="mb-2.5">
      <FilterChip active={personIds.size === 0} onToggle={() => setPersonIds(new Set())}>
        Svi
      </FilterChip>
      <MemberFilterChips
        selected={personIds}
        onToggle={(personId) =>
          setPersonIds((prev) => {
            const next = new Set(prev);
            if (next.has(personId)) next.delete(personId);
            else next.add(personId);
            return next;
          })
        }
      />
    </FilterChipRow>
  );

  return (
    <AppScreen header={header}>
      {showFirstRun ? (
        <EmptyState
          icon={ClipboardDocumentCheckIcon}
          tone="purple"
          title="Ovde stoji sve što treba da se uradi"
          description={
            'Napravi prvu listu - npr. „Šoping" koju vidi cela porodica ili „Obaveze" samo za tebe. Zadatak sa datumom posle toga stiže i na Danas.'
          }
          action={{ label: "Dodaj prvu listu", onClick: openAdd }}
          examples={["Šoping", "Kućne obaveze", "Obaveze"].map((name) => ({
            label: name,
            onClick: () => openAddWithName(name),
          }))}
        />
      ) : tab === "lists" ? (
        <ListsTab
          lists={shownLists}
          familyLists={familyLists}
          personalLists={personalLists}
          grouped={listScope === "all"}
          scope={listScope}
          onScopeChange={setListScope}
          loading={listsQuery.isLoading && lists.length === 0}
          today={today}
          onAdd={openAdd}
          onAddWithName={openAddWithName}
        />
      ) : (
        <>
          {personRow}

          <TaskStatStrip counts={counts} />

          {datedLoading ? <DatedSkeleton /> : null}

          {!datedLoading && sections.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-border bg-card px-4 py-5 text-center text-sm font-normal text-muted-foreground">
              {personIds.size > 0
                ? "Za izabrane osobe nema ničega sa datumom."
                : "Ništa ne kasni i ništa nije zakazano za danas ili sutra."}
            </p>
          ) : null}

          {!datedLoading
            ? sections.map((section) => {
                const isExpanded = expanded.has(section.key);
                const shown = isExpanded ? section.items : section.items.slice(0, SECTION_LIMIT);
                const hidden = section.items.length - shown.length;
                return (
                  <section key={section.key} className="mt-4">
                    {/* Counts what is still OUTSTANDING, not what is drawn: a
                        row ticked during this visit stays on screen for undo,
                        and counting it would put this number one above the tile
                        that says the same thing at the top of the screen. */}
                    {section.day ? (
                      <AgendaDateHeader
                        day={section.day}
                        today={today}
                        tomorrow={tomorrow}
                        count={openCount(section.items)}
                      />
                    ) : (
                      <SectionHeading
                        count={openCount(section.items)}
                        tone={section.late ? "neg" : "default"}
                      >
                        {section.label}
                      </SectionHeading>
                    )}
                    <div className="mt-1.5 space-y-1.5">
                      {shown.map((item) => (
                        <TaskRow
                          key={agendaItemKey(item)}
                          item={item}
                          onClick={() => setOpenTask(item)}
                          dateLabel={section.late ? formatDate(item.date) : undefined}
                        />
                      ))}
                    </div>
                    {hidden > 0 || isExpanded ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(section.key)}
                        className="mt-1.5 block w-full rounded-lg border border-dashed border-border py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
                      >
                        {isExpanded ? "Prikaži manje" : `Prikaži još ${hidden}`}
                      </button>
                    ) : null}
                  </section>
                );
              })
            : null}

          {/* No "Pregled" row down here any more: the tile strip at the top IS
              the four cuts now, and repeating them as chips said the same thing
              twice with different words. */}
        </>
      )}

      {dialog}

      <TaskQuickAddFlow open={addTaskOpen} onOpenChange={setAddTaskOpen} />

      <TaskDetailSheet
        open={openTask !== null}
        onOpenChange={(next) => {
          if (!next) setOpenTask(null);
        }}
        task={openTask?.task ?? null}
        occurrenceDate={detailSheetDates(openTask).occurrenceDate}
        effectiveDate={detailSheetDates(openTask).effectiveDate}
        assigneeIds={openTask?.assigneeIds}
        missed={openTask?.missed}
      />
    </AppScreen>
  );
}

/**
 * The "Liste" half: the scope chips, then the grid.
 *
 * Under "Sve" the grid renders as two labelled groups rather than one run of
 * tiles, so the commonest case needs no tap at all - "mine" and "ours" are two
 * different drawers and 10+ lists in one pile is what made this hard to read.
 * Picking a scope drops the headings: the chip already says what you are
 * looking at, and repeating it would be saying the same thing twice.
 */
function ListsTab({
  lists,
  familyLists,
  personalLists,
  grouped,
  scope,
  onScopeChange,
  loading,
  today,
  onAdd,
  onAddWithName,
}: {
  lists: ListWithTasks[];
  familyLists: ListWithTasks[];
  personalLists: ListWithTasks[];
  grouped: boolean;
  scope: ScopeFilter;
  onScopeChange: (next: ScopeFilter) => void;
  loading: boolean;
  today: string;
  onAdd: () => void;
  onAddWithName: (name: string) => void;
}) {
  const groups = grouped
    ? [
        { key: "family", label: "Porodične", items: familyLists },
        { key: "personal", label: "Lične", items: personalLists },
      ].filter((group) => group.items.length > 0)
    : [{ key: scope, label: null, items: lists }];

  return (
    <>
      <FilterChipRow ariaLabel="Vrsta liste">
        {SCOPE_FILTERS.map((entry) => (
          <FilterChip
            key={entry.value}
            active={scope === entry.value}
            onToggle={() => onScopeChange(entry.value)}
          >
            {entry.label}
          </FilterChip>
        ))}
      </FilterChipRow>

      {loading ? <ListsGridSkeleton /> : null}

      {!loading && lists.length === 0 ? (
        <EmptyState
          icon={ClipboardDocumentCheckIcon}
          tone="purple"
          title={scope === "all" ? "Još nemaš nijednu listu" : "Ovde nema nijedne liste"}
          description={
            scope === "personal"
              ? "Lična lista je samo tvoja - niko drugi u porodici je ne vidi."
              : scope === "family"
                ? "Porodičnu listu vide svi, i svako može da doda stavku."
                : 'Napravi prvu - npr. „Šoping" koju vidi cela porodica ili „Obaveze" samo za tebe.'
          }
          action={{ label: "Dodaj listu", onClick: onAdd }}
          examples={
            scope === "all"
              ? ["Šoping", "Kućne obaveze", "Obaveze"].map((name) => ({
                  label: name,
                  onClick: () => onAddWithName(name),
                }))
              : undefined
          }
        />
      ) : null}

      {!loading && lists.length > 0
        ? groups.map((group) => (
            <section key={group.key} className="mt-2 first:mt-1">
              {group.label ? (
                <SectionHeading count={group.items.length}>{group.label}</SectionHeading>
              ) : null}
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {group.items.map((list) => (
                  <ListGridCard key={list.id} list={list} today={today} />
                ))}
              </div>
            </section>
          ))
        : null}

      {/* Its own full-width row, in every state. As the last cell of the grid it
          read as belonging to whichever group happened to render last. */}
      {!loading && lists.length > 0 ? <NewListRow onClick={onAdd} /> : null}
    </>
  );
}

const SCOPE_FILTERS: ReadonlyArray<{ value: ScopeFilter; label: string }> = [
  { value: "all", label: "Sve" },
  { value: "family", label: "Porodične" },
  { value: "personal", label: "Lične" },
];

type DatedSection = {
  key: string;
  label: string;
  /** Set for a real calendar day, which prints as "12. avgust - Danas - Sreda". */
  day: string | null;
  late: boolean;
  items: TaskAgendaItem[];
};

/**
 * Which sections the dated block shows: what is late, then today, then tomorrow.
 *
 * It used to take a `scope` from the stat tiles, which also offered a whole-week
 * day-by-day view. The tiles became navigation to the four cross-list cuts, so
 * the week view moved to where it always belonged - "Zakazano", which is exactly
 * that, only over ninety days instead of seven.
 */
function buildSections({
  today,
  tomorrow,
  lateItems,
  todayItems,
  tomorrowItems,
}: {
  today: string;
  tomorrow: string;
  lateItems: TaskAgendaItem[];
  todayItems: TaskAgendaItem[];
  tomorrowItems: TaskAgendaItem[];
}): DatedSection[] {
  return [
    // Kasni spans many days, so it keeps a plain label and each row carries its
    // own date; the other two ARE a day and print as one.
    ...(lateItems.length > 0
      ? [{ key: "late", label: "Kasni", day: null, late: true, items: lateItems }]
      : []),
    ...(todayItems.length > 0
      ? [{ key: "today", label: "", day: today, late: false, items: todayItems }]
      : []),
    ...(tomorrowItems.length > 0
      ? [{ key: "tomorrow", label: "", day: tomorrow, late: false, items: tomorrowItems }]
      : []),
  ];
}

function DatedSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-4 space-y-1.5">
      <span className="sr-only">Učitavanje</span>
      {["w-2/5", "w-3/5", "w-1/2"].map((width) => (
        <div
          key={width}
          className="flex items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3"
        >
          <Skeleton className="size-[26px] shrink-0 rounded-full" />
          <span className="min-w-0 flex-1">
            <Skeleton className={cn("h-4", width)} />
          </span>
        </div>
      ))}
    </div>
  );
}

function ListsGridSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-1.5 grid grid-cols-2 gap-1.5">
      <span className="sr-only">Učitavanje</span>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex min-h-[74px] flex-col justify-between rounded-xl border border-border bg-card p-2.5"
        >
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-[3px] w-full" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}
