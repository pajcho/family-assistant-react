import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { MemberFilterChips } from "@/components/common/MemberFilterChips";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { TaskComposer } from "@/components/tasks/TaskComposer";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { TaskRow } from "@/components/tasks/TaskRow";
import { TaskScreenHeader, TaskScreenShell } from "@/components/tasks/TaskScreenShell";
import {
  SCHEDULED_WINDOW_DAYS,
  smartListDefinition,
  type SmartListKey,
} from "@/components/tasks/smartLists";
import {
  detailSheetDates,
  isTaskAgendaItem,
  matchesPersonFilter,
  outstandingCount,
  taskAgendaItem,
  undatedTaskInstance,
  type TaskAgendaItem,
} from "@/components/tasks/taskItemModel";
import { useTaskAgendaItems } from "@/components/tasks/taskItems";
import { useTickedHereLinger } from "@/components/tasks/useTickedHereLinger";
import { agendaItemKey } from "@/hooks/useAgenda";
import { useIsWide } from "@/hooks/useIsWide";
import { useOverdueTasks } from "@/hooks/useOverdueTasks";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import { cn } from "@/lib/cn";
import { formatDate } from "@/utils/date";
import { shiftIsoByDays } from "@/utils/pickerGrid";
import { isFutureOccurrence } from "@/utils/task";

/**
 * ONE screen for three of the four cross-list views - Kasni, Zakazano and Inbox
 * (Završeno groups by a different date entirely and has its own screen).
 * Header, person rail, day groups and composer are identical to a real
 * list; only the source of the rows differs, which is the whole reason a smart
 * list is worth having rather than four bespoke screens.
 *
 * Every source is a pure selection over the same caches the rest of /tasks reads
 * (`useTasksList`, `useTaskAssignees`, `useTaskOccurrenceRows`, plus
 * `useOverdueTasks` for the late arm). No schema, no query, no server-side view.
 *
 * The one thing a cross-list view must add is which list a row came from, and
 * `TaskRow` puts it in the meta line by default - which is also the difference
 * from Danas: there the meta line says what KIND of thing a row is, here it says
 * where it lives.
 */

export type SmartTaskListBodyProps = {
  source: SmartListKey;
  /** Whose rows to show. Owned by the host - the rail lives outside this. */
  personIds: ReadonlySet<string>;
  /** Lets an empty state offer "prikazi sve" without owning the filter. */
  onClearFilter: () => void;
};

/**
 * The rows of one cross-list view, with no chrome of its own.
 *
 * Two hosts: its own route (below, with a title, a back button and a person
 * rail) and the /tasks overview, where the four tiles switch between these
 * bodies in place. The overview already has the rail and the title is whichever
 * tile you tapped, so none of that belongs in here.
 */
export function SmartTaskListBody({ source, personIds, onClearFilter }: SmartTaskListBodyProps) {
  const today = useToday().str;
  const tomorrow = shiftIsoByDays(today, 1) ?? today;
  const windowEnd = shiftIsoByDays(today, SCHEDULED_WINDOW_DAYS) ?? today;
  const navigate = useNavigate();

  const { byTask } = useTaskAssignees();
  // Person-aware at the source: with a rail chip on, "late" means late FOR THEM,
  // which filtering the rows afterwards cannot express - see `useOverdueTasks`.
  const overdue = useOverdueTasks(personIds);
  const agenda = useTaskAgendaItems({ from: today, to: windowEnd, today });
  const tasksQuery = useTasksList();
  const { byKey } = useTaskOccurrenceRows();

  const [openTask, setOpenTask] = useState<TaskAgendaItem | null>(null);

  // Same cached query the agenda hook reads, so this costs no extra fetch. The
  // linger needs the LIVE row for a task that has left the selection.
  const tasksById = useMemo(
    () => new Map((tasksQuery.data ?? []).map((task) => [task.id, task])),
    [tasksQuery.data],
  );

  const undatedItems = useMemo(
    () =>
      agenda.undated.map((task) =>
        taskAgendaItem(task, undatedTaskInstance(task, today), byTask.get(task.id) ?? [], today),
      ),
    [agenda.undated, byTask, today],
  );

  const selection = useMemo(() => {
    const keep = (item: TaskAgendaItem) => {
      if (source !== "inbox") return true;
      if (item.task.list_id !== null) return false;
      // Only what can actually be ticked. The Inbox is a CONTAINER - "what has
      // no list" - not a schedule, and a daily chore projected across the whole
      // 90-day window filled it with ninety identical locked rows for one task.
      // Zakazano keeps them, because there they are the point: that view IS the
      // calendar of what is coming. See `isFutureOccurrence` for the lock.
      return !isFutureOccurrence(item.task, item.date, today);
    };
    const pass = (item: TaskAgendaItem) => keep(item) && matchesPersonFilter(item, personIds);

    // Kasni is ONLY the overdue block; Zakazano leads with it and then walks the
    // window; the Inbox adds the someday pile, because a task with no date is
    // still in your inbox. The overdue rows arrive already narrowed to the rail,
    // so only the view's own `keep` applies to them.
    const late = overdue.items.filter(isTaskAgendaItem).filter(keep);
    const dated = source === "late" ? [] : agenda.items.filter(pass);
    const undated = source === "inbox" ? undatedItems.filter(pass) : [];
    return { late, dated, undated };
  }, [source, personIds, overdue.items, agenda.items, undatedItems, today]);

  // Rows ticked during THIS visit keep their place instead of vanishing under
  // the thumb - see `useTickedHereLinger`. They are folded back into the group
  // they came from, so "Kasni" still reads as Kasni with one line struck out.
  const lingering = useTickedHereLinger(
    [...selection.late, ...selection.dated, ...selection.undated],
    tasksById,
    agenda.isLoading || overdue.isLoading,
  );

  const groups = useMemo(() => {
    const out: Array<{
      key: string;
      label: string;
      /** Set for a real calendar day, which prints as "14. avgust - Petak". */
      day: string | null;
      late: boolean;
      items: TaskAgendaItem[];
    }> = [];
    const late = [...selection.late, ...lingering.filter((item) => item.date < today)];
    const dated = [
      ...selection.dated,
      ...lingering.filter((item) => item.task.due_date !== null && item.date >= today),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.sortKey - b.sortKey);
    const undatedWithLingering =
      source === "inbox"
        ? [...selection.undated, ...lingering.filter((item) => item.task.due_date === null)]
        : selection.undated;

    if (late.length > 0) {
      out.push({ key: "late", label: "Kasni", day: null, late: true, items: late });
    }
    const byDay = new Map<string, TaskAgendaItem[]>();
    for (const item of dated) {
      const bucket = byDay.get(item.date);
      if (bucket) bucket.push(item);
      else byDay.set(item.date, [item]);
    }
    for (const day of [...byDay.keys()].sort()) {
      out.push({ key: day, label: "", day, late: false, items: byDay.get(day) ?? [] });
    }
    if (undatedWithLingering.length > 0) {
      out.push({
        key: "undated",
        label: "Bez datuma",
        day: null,
        late: false,
        items: undatedWithLingering,
      });
    }
    return out;
  }, [selection, lingering, source, today]);

  // The Inbox's own archive: listless, dateless and already ticked before this
  // visit. Collapsed, because it is a place to look something up, not a place to
  // work - and it is the only path to a task that has no list AND no date, which
  // is what used to disappear on a tick with nowhere left to find it.
  const inboxDone = useMemo(() => {
    if (source !== "inbox") return [];
    const lingeringIds = new Set(lingering.map((item) => item.task.id));
    return agenda.undatedDone
      .filter((task) => task.list_id === null && !lingeringIds.has(task.id))
      .map((task) =>
        taskAgendaItem(task, undatedTaskInstance(task, today), byTask.get(task.id) ?? [], today),
      )
      .filter((item) => matchesPersonFilter(item, personIds));
  }, [source, agenda.undatedDone, lingering, byTask, personIds, today]);

  const isLoading = overdue.isLoading || agenda.isLoading;
  const total =
    selection.late.length + selection.dated.length + selection.undated.length + inboxDone.length;

  return (
    <>
      {isLoading ? <AgendaListSkeleton /> : null}

      {!isLoading && total === 0 ? (
        <SmartListEmptyState
          source={source}
          filtered={personIds.size > 0}
          onClearFilter={onClearFilter}
          onGoScheduled={() => {
            void navigate({ to: "/tasks/scheduled" });
          }}
        />
      ) : null}

      {!isLoading
        ? groups.map((group) => (
            // Sections touch, and the gap lives on the row list inside them:
            // both halves of the sticky handoff rule - see `SectionHeading`.
            <section key={group.key}>
              {/* Outstanding rows, not drawn rows - see `outstandingCount`. */}
              {group.day ? (
                <AgendaDateHeader
                  day={group.day}
                  today={today}
                  tomorrow={tomorrow}
                  count={outstandingCount(group.items, byKey, personIds)}
                  sticky
                />
              ) : (
                <SectionHeading
                  count={outstandingCount(group.items, byKey, personIds)}
                  tone={group.late ? "neg" : "default"}
                  sticky
                >
                  {group.label}
                </SectionHeading>
              )}
              <div className="space-y-1.5 pb-4">
                {group.items.map((item) => (
                  <TaskRow
                    key={agendaItemKey(item)}
                    item={item}
                    onClick={() => setOpenTask(item)}
                    dateLabel={group.late ? formatDate(item.date) : undefined}
                  />
                ))}
              </div>
            </section>
          ))
        : null}

      {!isLoading && inboxDone.length > 0 ? (
        <CompletedDisclosure items={inboxDone} onOpen={setOpenTask} />
      ) : null}

      {/* Kasni is the only view without a composer: adding a task there would
          immediately make it not-late, which is a confusing thing for a screen
          to do to what you just typed. */}
      {source !== "late" ? (
        <TaskComposer
          listId={null}
          initialDraft={composerDefaults(source, today)}
          placeholder="Dodaj zadatak…"
        />
      ) : null}

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
    </>
  );
}

/**
 * The same rows as their own screen: title, back and person rail around the
 * body. This is what the `/tasks/late|scheduled|inbox` routes render, and what
 * the desktop master-detail pane shows.
 */
export function SmartTaskListScreen({ source }: { source: SmartListKey }) {
  const definition = smartListDefinition(source);
  const isWide = useIsWide();
  const navigate = useNavigate();
  const [personIds, setPersonIds] = useState<ReadonlySet<string>>(() => new Set());

  return (
    <TaskScreenShell
      isWide={isWide}
      header={
        <TaskScreenHeader
          title={definition.label}
          subtitle={definition.subtitle}
          showBack={!isWide}
          onBack={() => {
            void navigate({ to: "/tasks" });
          }}
          toolbar={
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
          }
        />
      }
    >
      <SmartTaskListBody
        source={source}
        personIds={personIds}
        onClearFilter={() => setPersonIds(new Set())}
      />
    </TaskScreenShell>
  );
}

/**
 * What a new task inherits from the view it was typed in, so a row cannot land
 * somewhere it would not show. Zakazano is about dates, so it pre-fills today;
 * the Inbox is the one that pre-fills nothing, which is exactly what it is for.
 */
function composerDefaults(source: SmartListKey, today: string) {
  if (source === "scheduled") return { dueDate: today };
  return undefined;
}

/** The Inbox's collapsed archive. Shut by default - it is lookup, not work. */
function CompletedDisclosure({
  items,
  onOpen,
}: {
  items: TaskAgendaItem[];
  onOpen: (item: TaskAgendaItem) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-0.5 py-2 text-left text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRightIcon
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        Završeno ({items.length})
      </button>
      {open ? (
        <div className="mt-1.5 space-y-1.5">
          {items.map((item) => (
            <TaskRow key={agendaItemKey(item)} item={item} onClick={() => onOpen(item)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SmartListEmptyState({
  source,
  filtered,
  onClearFilter,
  onGoScheduled,
}: {
  source: SmartListKey;
  filtered: boolean;
  onClearFilter: () => void;
  onGoScheduled: () => void;
}) {
  if (filtered) {
    return (
      <EmptyState
        variant="filter"
        title="Za izabrane osobe nema ništa"
        description="Probaj drugu osobu ili prikaži sve."
        secondaryAction={{ label: "Prikaži sve", onClick: onClearFilter }}
      />
    );
  }

  const definition = smartListDefinition(source);

  if (source === "late") {
    return (
      <EmptyState
        variant="filter"
        title="Ništa ne kasni"
        description="Svi zadaci sa rokom su na vreme."
        secondaryAction={{ label: "Pogledaj zakazano", onClick: onGoScheduled }}
      />
    );
  }

  return (
    <EmptyState
      icon={definition.icon}
      tone="purple"
      title={source === "scheduled" ? "Nijedan zadatak nema datum" : "Inbox je prazan"}
      description={
        source === "scheduled"
          ? "Zadatak sa datumom stiže i na Danas i u Kalendar. Dodaj ga u polju ispod."
          : "Ovde stižu zadaci koje dodaš bez liste. Dodaj ih u polju ispod, pa ih kasnije razvrstaj."
      }
    />
  );
}
