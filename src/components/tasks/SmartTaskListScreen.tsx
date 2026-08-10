import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { MemberFilterChips } from "@/components/common/MemberFilterChips";
import { SectionHeading } from "@/components/common/SectionHeading";
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
  taskAgendaItem,
  undatedTaskInstance,
  type TaskAgendaItem,
} from "@/components/tasks/taskItemModel";
import { useTaskAgendaItems } from "@/components/tasks/taskItems";
import { useTaskEditFlow } from "@/components/tasks/useTaskEditFlow";
import { agendaItemKey } from "@/hooks/useAgenda";
import { useIsWide } from "@/hooks/useIsWide";
import { useOverdueTasks } from "@/hooks/useOverdueTasks";
import { useProfile } from "@/hooks/useProfile";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useToday } from "@/hooks/useToday";
import { formatDate } from "@/utils/date";
import { shiftIsoByDays } from "@/utils/pickerGrid";

/**
 * ONE screen for all four cross-list views - Kasni, Zakazano, Meni dodeljeno and
 * Inbox. Header, person rail, day groups and composer are identical to a real
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

export type SmartTaskListScreenProps = {
  source: SmartListKey;
};

export function SmartTaskListScreen({ source }: SmartTaskListScreenProps) {
  const definition = smartListDefinition(source);
  const today = useToday().str;
  const windowEnd = shiftIsoByDays(today, SCHEDULED_WINDOW_DAYS) ?? today;
  const isWide = useIsWide();
  const navigate = useNavigate();

  const viewerId = useProfile().profile?.id ?? null;
  const { byTask } = useTaskAssignees();
  const overdue = useOverdueTasks();
  const agenda = useTaskAgendaItems({ from: today, to: windowEnd, today });

  const [personIds, setPersonIds] = useState<ReadonlySet<string>>(() => new Set());
  const [openTask, setOpenTask] = useState<TaskAgendaItem | null>(null);
  const taskEdit = useTaskEditFlow();

  // "Meni dodeljeno" IS a person filter, so it does not also carry a rail that
  // would offer to narrow it to somebody else.
  const showPersonRail = source !== "mine";

  const undatedItems = useMemo(
    () =>
      agenda.undated.map((task) =>
        taskAgendaItem(task, undatedTaskInstance(task, today), byTask.get(task.id) ?? [], today),
      ),
    [agenda.undated, byTask, today],
  );

  const selection = useMemo(() => {
    const keep = (item: TaskAgendaItem) => {
      if (source === "mine") return viewerId !== null && item.assigneeIds.includes(viewerId);
      if (source === "inbox") return item.task.list_id === null;
      return true;
    };
    const inRail = (item: TaskAgendaItem) =>
      showPersonRail ? matchesPersonFilter(item, personIds) : true;
    const pass = (item: TaskAgendaItem) => keep(item) && inRail(item);

    // Kasni is ONLY the overdue block; Zakazano leads with it and then walks the
    // window; the two person-shaped views add the someday pile on top, because a
    // task with no date is still assigned to you and still in your inbox.
    const late = overdue.items.filter(isTaskAgendaItem).filter(pass);
    const dated = source === "late" ? [] : agenda.items.filter(pass);
    const undated = source === "mine" || source === "inbox" ? undatedItems.filter(pass) : [];
    return { late, dated, undated };
  }, [source, viewerId, showPersonRail, personIds, overdue.items, agenda.items, undatedItems]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; late: boolean; items: TaskAgendaItem[] }> = [];
    if (selection.late.length > 0) {
      out.push({ key: "late", label: "Kasni", late: true, items: selection.late });
    }
    const byDay = new Map<string, TaskAgendaItem[]>();
    for (const item of selection.dated) {
      const bucket = byDay.get(item.date);
      if (bucket) bucket.push(item);
      else byDay.set(item.date, [item]);
    }
    const tomorrow = shiftIsoByDays(today, 1) ?? today;
    for (const day of [...byDay.keys()].sort()) {
      out.push({
        key: day,
        label: day === today ? "Danas" : day === tomorrow ? "Sutra" : formatDate(day),
        late: false,
        items: byDay.get(day) ?? [],
      });
    }
    if (selection.undated.length > 0) {
      out.push({ key: "undated", label: "Bez datuma", late: false, items: selection.undated });
    }
    return out;
  }, [selection, today]);

  const isLoading = overdue.isLoading || agenda.isLoading;
  const total = selection.late.length + selection.dated.length + selection.undated.length;

  const header = (
    <TaskScreenHeader
      title={definition.label}
      subtitle={definition.subtitle}
      showBack={!isWide}
      onBack={() => {
        void navigate({ to: "/tasks" });
      }}
      toolbar={
        showPersonRail ? (
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
        ) : undefined
      }
    />
  );

  return (
    <TaskScreenShell isWide={isWide} header={header}>
      {isLoading ? <AgendaListSkeleton /> : null}

      {!isLoading && total === 0 ? (
        <SmartListEmptyState
          source={source}
          filtered={personIds.size > 0}
          onClearFilter={() => setPersonIds(new Set())}
          onGoScheduled={() => {
            void navigate({ to: "/tasks/scheduled" });
          }}
        />
      ) : null}

      {!isLoading
        ? groups.map((group) => (
            <section key={group.key} className="mb-4">
              <SectionHeading count={group.items.length} tone={group.late ? "neg" : "default"}>
                {group.label}
              </SectionHeading>
              <div className="mt-1.5 space-y-1.5">
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

      {/* Kasni is the only view without a composer: adding a task there would
          immediately make it not-late, which is a confusing thing for a screen to
          do to what you just typed. */}
      {source !== "late" ? (
        <TaskComposer
          listId={null}
          variant={isWide ? "inline" : "pinned"}
          initialDraft={composerDefaults(source, today, viewerId)}
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
        onEdit={taskEdit.edit}
      />
      {taskEdit.dialog}
    </TaskScreenShell>
  );
}

/**
 * What a new task inherits from the view it was typed in, so a row cannot land
 * somewhere it would not show. Zakazano is about dates, so it pre-fills today;
 * "Meni dodeljeno" pre-assigns the viewer; the Inbox is the one that pre-fills
 * nothing, which is exactly what it is for.
 */
function composerDefaults(source: SmartListKey, today: string, viewerId: string | null) {
  if (source === "scheduled") return { dueDate: today };
  if (source === "mine") return { assigneeIds: viewerId ? [viewerId] : [] };
  return undefined;
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
      title={
        source === "scheduled"
          ? "Nijedan zadatak nema datum"
          : source === "mine"
            ? "Ništa nije dodeljeno tebi"
            : "Inbox je prazan"
      }
      description={
        source === "scheduled"
          ? "Zadatak sa datumom stiže i na Danas i u Kalendar. Dodaj ga u polju ispod."
          : source === "mine"
            ? 'Zadatak postaje tvoj kada ti ga neko dodeli - ili kada ga sam dodaš sa „Za koga".'
            : "Ovde stižu zadaci koje dodaš bez liste. Dodaj ih u polju ispod, pa ih kasnije razvrstaj."
      }
    />
  );
}
