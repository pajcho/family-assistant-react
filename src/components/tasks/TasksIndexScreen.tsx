import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ClipboardDocumentCheckIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { IconButton } from "@/components/common/IconButton";
import { MemberFilterChips } from "@/components/common/MemberFilterChips";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { Skeleton } from "@/components/ui/skeleton";
import { ListGridCard, NewListGridCard } from "@/components/tasks/ListGridCard";
import { SMART_LISTS } from "@/components/tasks/smartLists";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { TaskRow } from "@/components/tasks/TaskRow";
import { TaskStatStrip, type TaskStatKey } from "@/components/tasks/TaskStatStrip";
import {
  detailSheetDates,
  isTaskAgendaItem,
  matchesPersonFilter,
  type TaskAgendaItem,
} from "@/components/tasks/taskItemModel";
import { useTaskAgendaItems } from "@/components/tasks/taskItems";
import { useCreateListFlow } from "@/components/tasks/useCreateListFlow";
import { useTaskEditFlow } from "@/components/tasks/useTaskEditFlow";
import { agendaItemKey } from "@/hooks/useAgenda";
import { useOverdueTasks } from "@/hooks/useOverdueTasks";
import { useSearchDialog } from "@/hooks/useSearchDialog";
import { useListsWithTasks } from "@/hooks/useTasks";
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
 * in. Now the late and today's work is on the surface and tickable in place, and
 * the lists are a compact grid underneath - which is where you go to add or
 * reorganise, not to find out what is going on.
 *
 * Two independent queries feed it, and that is deliberate: the lists grid renders
 * from the `lists` cache the moment it is warm while the dated sections fill in
 * behind it. A person arriving from the bottom bar sees their lists immediately
 * rather than a whole-screen spinner.
 */

/** Rows per section before "Prikaži još" - about a screenful on a phone. */
const SECTION_LIMIT = 5;

export function TasksIndexScreen() {
  const today = useToday().str;
  const tomorrow = shiftIsoByDays(today, 1) ?? today;
  const weekEnd = shiftIsoByDays(today, 6) ?? today;

  const { openSearch } = useSearchDialog();
  const { openAdd, openAddWithName, dialog } = useCreateListFlow();
  const taskEdit = useTaskEditFlow();

  const [personIds, setPersonIds] = useState<ReadonlySet<string>>(() => new Set());
  const [scope, setScope] = useState<TaskStatKey | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [openTask, setOpenTask] = useState<TaskAgendaItem | null>(null);

  const listsQuery = useListsWithTasks();
  const lists = useMemo<ListWithTasks[]>(
    () => [...(listsQuery.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [listsQuery.data],
  );

  const overdue = useOverdueTasks();
  const week = useTaskAgendaItems({ from: today, to: weekEnd, today });

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

  const sections = useMemo(
    () =>
      buildSections({ scope, today, tomorrow, lateItems, todayItems, tomorrowItems, weekItems }),
    [scope, today, tomorrow, lateItems, todayItems, tomorrowItems, weekItems],
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

  const header = (
    <div className="flex flex-col gap-2.5">
      <ScreenHeaderRow
        title="Zadaci"
        actions={
          <IconButton icon={MagnifyingGlassIcon} aria-label="Pretraži" onClick={openSearch} />
        }
      />
      <FilterChipRow ariaLabel="Osoba">
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
    </div>
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
      ) : (
        <>
          <TaskStatStrip
            late={lateItems.length}
            today={todayItems.filter((item) => !item.isDone).length}
            week={weekItems.filter((item) => !item.isDone).length}
            active={scope}
            onSelect={setScope}
          />

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
                    <SectionHeading
                      count={section.items.length}
                      tone={section.late ? "neg" : "default"}
                    >
                      {section.label}
                    </SectionHeading>
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

          <section className="mt-5">
            <SectionHeading count={lists.length > 0 ? lists.length : undefined}>
              Liste
            </SectionHeading>
            {listsQuery.isLoading && lists.length === 0 ? (
              <ListsGridSkeleton />
            ) : (
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {lists.map((list) => (
                  <ListGridCard key={list.id} list={list} today={today} />
                ))}
                <NewListGridCard onClick={openAdd} />
              </div>
            )}
          </section>

          {/* The four cross-list cuts. On desktop they lead the sidebar; here they
              sit under the grid, because the stat strip above already answers
              "what is late" and these are the ways IN to the rest - above all the
              Inbox, which is otherwise the one place a task can hide. */}
          <section className="mt-5">
            <SectionHeading>Pregled</SectionHeading>
            <FilterChipRow ariaLabel="Pregledi zadataka" className="mt-0.5">
              {SMART_LISTS.filter((entry) => !entry.hideWhenEmpty || overdue.items.length > 0).map(
                (entry) => (
                  <Link
                    key={entry.key}
                    to={entry.to}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5",
                      "text-[12.5px] font-semibold whitespace-nowrap transition-colors hover:bg-muted",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      entry.key === "late" ? "text-neg" : "text-muted-foreground",
                    )}
                  >
                    <entry.icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {entry.label}
                  </Link>
                ),
              )}
            </FilterChipRow>
          </section>
        </>
      )}

      {dialog}

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
        onEdit={taskEdit.edit}
      />
      {taskEdit.dialog}
    </AppScreen>
  );
}

type DatedSection = {
  key: string;
  label: string;
  late: boolean;
  items: TaskAgendaItem[];
};

/**
 * Which sections the dated block shows. The default is the three a person acts
 * on - late, today, tomorrow - and a stat tile narrows to its own slice, with
 * Nedelja opening the whole week day by day.
 */
function buildSections({
  scope,
  today,
  tomorrow,
  lateItems,
  todayItems,
  tomorrowItems,
  weekItems,
}: {
  scope: TaskStatKey | null;
  today: string;
  tomorrow: string;
  lateItems: TaskAgendaItem[];
  todayItems: TaskAgendaItem[];
  tomorrowItems: TaskAgendaItem[];
  weekItems: TaskAgendaItem[];
}): DatedSection[] {
  const late: DatedSection[] =
    lateItems.length > 0 ? [{ key: "late", label: "Kasni", late: true, items: lateItems }] : [];

  if (scope === "late") return late;
  if (scope === "today") {
    return todayItems.length > 0
      ? [{ key: "today", label: "Danas", late: false, items: todayItems }]
      : [];
  }

  if (scope === "week") {
    const byDay = new Map<string, TaskAgendaItem[]>();
    for (const item of weekItems) {
      const bucket = byDay.get(item.date);
      if (bucket) bucket.push(item);
      else byDay.set(item.date, [item]);
    }
    return [
      ...late,
      ...[...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, items]) => ({
          key: day,
          label: day === today ? "Danas" : day === tomorrow ? "Sutra" : formatDate(day),
          late: false,
          items,
        })),
    ];
  }

  return [
    ...late,
    ...(todayItems.length > 0
      ? [{ key: "today", label: "Danas", late: false, items: todayItems }]
      : []),
    ...(tomorrowItems.length > 0
      ? [{ key: "tomorrow", label: "Sutra", late: false, items: tomorrowItems }]
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
