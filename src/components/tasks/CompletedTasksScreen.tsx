import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircleIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { MemberFilterChips } from "@/components/common/MemberFilterChips";
import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { TaskScreenHeader, TaskScreenShell } from "@/components/tasks/TaskScreenShell";
import {
  completedEntries,
  groupCompletedByDay,
  latenessLabel,
  type CompletedEntry,
} from "@/components/tasks/completedTasks";
import { COMPLETED_WINDOW_DAYS, smartListDefinition } from "@/components/tasks/smartLists";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useIsWide } from "@/hooks/useIsWide";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useListsWithTasks, useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import { getDisplayName } from "@/utils/identity";
import { shiftIsoByDays } from "@/utils/pickerGrid";
import type { Profile } from "@/types/database";

/**
 * "Završeno" - the one /tasks view that looks backwards.
 *
 * It exists because a ticked task used to be genuinely unreachable: inside a
 * list it slides into the collapsed done section, but a task with no list and
 * no date left the screen and no surface anywhere showed it again. Search found
 * the row by name and then sent you to the Inbox, which does not render it.
 *
 * Grouped by the day of the TICK rather than the day it was due, because the
 * question here is "what did we get done", and each row says who finished it and
 * whether it made its deadline - the only place in the app that reports on the
 * past rather than the next thing to do.
 *
 * Read-only by design: un-ticking a task is a real decision (a repeating one
 * asks about the occurrence versus the series), so it goes through the detail
 * sheet like everywhere else rather than a checkbox that undoes history on a
 * mis-tap.
 */
export type CompletedTasksBodyProps = {
  /** Whose ticks to show. Owned by the host - the rail lives outside this. */
  personIds: ReadonlySet<string>;
  onClearFilter: () => void;
};

/**
 * The finished rows, with no chrome of its own - see `SmartTaskListBody` for
 * why the title and the rail belong to the host rather than in here.
 */
export function CompletedTasksBody({ personIds, onClearFilter }: CompletedTasksBodyProps) {
  const today = useToday().str;

  const tasksQuery = useTasksList();
  const { occurrences, isLoading: occurrencesLoading } = useTaskOccurrenceRows();
  const listsQuery = useListsWithTasks();
  const { byId } = useFamilyMembers();

  const [openEntry, setOpenEntry] = useState<CompletedEntry | null>(null);

  const since = shiftIsoByDays(today, -COMPLETED_WINDOW_DAYS) ?? today;
  const entries = useMemo(
    () => completedEntries(tasksQuery.data ?? [], occurrences, since),
    [tasksQuery.data, occurrences, since],
  );

  // The rail filters on WHO TICKED IT, not on who it was assigned to - on a
  // screen about what happened, "Ana" means the work Ana actually did.
  const shown = useMemo(
    () =>
      personIds.size === 0
        ? entries
        : entries.filter((entry) => entry.byPersonId !== null && personIds.has(entry.byPersonId)),
    [entries, personIds],
  );
  const groups = useMemo(() => groupCompletedByDay(shown), [shown]);

  const listNameById = useMemo(
    () => new Map((listsQuery.data ?? []).map((list) => [list.id, list.name])),
    [listsQuery.data],
  );

  const isLoading = tasksQuery.isLoading || occurrencesLoading;
  // Tomorrow can never appear on a backwards-looking list, but the header takes
  // it to decide the relative token, so it is passed for completeness.
  const tomorrow = shiftIsoByDays(today, 1) ?? today;
  const yesterday = shiftIsoByDays(today, -1) ?? today;

  return (
    <>
      {isLoading ? <AgendaListSkeleton /> : null}

      {!isLoading && groups.length === 0 ? (
        <EmptyState
          icon={CheckCircleIcon}
          tone="emerald"
          title={personIds.size > 0 ? "Ništa od izabranih osoba" : "Još ništa nije završeno"}
          description={
            personIds.size > 0
              ? `U poslednjih ${COMPLETED_WINDOW_DAYS} dana niko od izabranih nije ništa štiklirao.`
              : `Ovde stoji sve što je štiklirano u poslednjih ${COMPLETED_WINDOW_DAYS} dana - ko je šta uradio i da li je stiglo na vreme.`
          }
          action={personIds.size > 0 ? { label: "Prikaži sve", onClick: onClearFilter } : undefined}
        />
      ) : null}

      {!isLoading
        ? groups.map((group) => (
            // No margin and no section padding - the day gap is the row list's,
            // so the pinned header travels the whole section. See
            // `SectionHeading`'s sticky recipe.
            <section key={group.day}>
              <AgendaDateHeader
                day={group.day}
                today={today}
                tomorrow={tomorrow}
                yesterday={yesterday}
                count={group.items.length}
                sticky
              />
              <div className="space-y-1.5 pb-4">
                {group.items.map((entry) => (
                  <CompletedRow
                    key={entry.key}
                    entry={entry}
                    listName={
                      entry.task.list_id ? (listNameById.get(entry.task.list_id) ?? null) : null
                    }
                    member={entry.byPersonId ? (byId.get(entry.byPersonId) ?? null) : null}
                    onClick={() => setOpenEntry(entry)}
                  />
                ))}
              </div>
            </section>
          ))
        : null}

      <TaskDetailSheet
        open={openEntry !== null}
        onOpenChange={(next) => {
          if (!next) setOpenEntry(null);
        }}
        task={openEntry?.task ?? null}
        occurrenceDate={openEntry?.occurrenceDate ?? null}
        effectiveDate={openEntry?.occurrenceDate ?? null}
      />
    </>
  );
}

/** The same rows as their own screen - what the `/tasks/done` route renders. */
export function CompletedTasksScreen() {
  const definition = smartListDefinition("done");
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
            <FilterChipRow ariaLabel="Ko je završio">
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
      <CompletedTasksBody personIds={personIds} onClearFilter={() => setPersonIds(new Set())} />
    </TaskScreenShell>
  );
}

/**
 * One finished thing. Name struck through, then the one meta line that earns its
 * place: where it lived, who ticked it, and whether it made its deadline - the
 * last of which is why "kasnio 4 dana" is worth reading a week later.
 */
function CompletedRow({
  entry,
  listName,
  member,
  onClick,
}: {
  entry: CompletedEntry;
  listName: string | null;
  /** The roster row for whoever ticked it - an id alone renders as "?". */
  member: Profile | null;
  onClick: () => void;
}) {
  const late = latenessLabel(entry.daysLate);
  const meta = [listName ?? "Inbox", late].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <CheckCircleIcon className="size-[22px] shrink-0 text-pos" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-muted-foreground line-through">
          {entry.task.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[11.5px] font-normal text-muted-foreground">
          <span className="min-w-0 truncate">{meta}</span>
          {entry.daysLate !== null && entry.daysLate > 0 ? (
            <span className="shrink-0 text-neg">•</span>
          ) : null}
        </span>
      </span>
      {member ? (
        <MemberAvatar
          member={member}
          size="sm"
          className="shrink-0"
          title={getDisplayName({
            firstName: member.first_name,
            lastName: member.last_name,
            email: null,
          })}
        />
      ) : null}
    </button>
  );
}
