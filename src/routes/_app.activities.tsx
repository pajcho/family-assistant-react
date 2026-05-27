import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { addDays, format, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog";
import { BlockActionDialog } from "@/components/activities/BlockActionDialog";
import { ColorAssignmentPopover } from "@/components/activities/ColorAssignmentPopover";
import { PersonChip } from "@/components/activities/PersonChip";
import { ShiftControls } from "@/components/activities/ShiftControls";
import { WeekGrid } from "@/components/activities/WeekGrid";
import type { ActivityFormPayload } from "@/components/activities/ActivityForm";
import type { ResolvedActivityBlock } from "@/utils/activity";
import {
  useActivities,
  useCreateActivity,
  useDeleteActivity,
  useUpdateActivity,
} from "@/hooks/useActivities";
import {
  useActivityParticipants,
  useReplaceActivityParticipants,
} from "@/hooks/useActivityParticipants";
import { useActivitySchedule, useReplaceActivitySchedule } from "@/hooks/useActivitySchedule";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile } from "@/hooks/useProfile";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useWeekActivities } from "@/hooks/useWeekActivities";
import type { Activity, Profile } from "@/types/database";
import { fallbackColorForProfile, getThisWeekStart } from "@/utils/activity";
import { formatDate, srLocale } from "@/utils/date";
import { cn } from "@/lib/cn";
import { getDisplayName } from "@/utils/identity";

export const Route = createFileRoute("/_app/activities")({
  component: ActivitiesPage,
});

function ActivitiesPage() {
  const { profile } = useProfile();
  const { members } = useFamilyMembers();
  const activitiesQuery = useActivities();
  const scheduleQuery = useActivitySchedule();
  const { byPersonId: anchorsByPersonId } = useSchoolShiftAnchors();

  const [weekStart, setWeekStart] = React.useState<string>(() => getThisWeekStart());
  const [personFilter, setPersonFilter] = React.useState<Set<string>>(() => new Set());
  // A/B patterns are only meaningful when the person's shift actually
  // alternates. For 1st/2nd-graders (always-morning), there's nothing to
  // alternate between — coerce their activities to fire every week.
  const peopleWithShift = React.useMemo(() => {
    const set = new Set<string>();
    for (const [personId, anchor] of anchorsByPersonId) {
      if (anchor.is_alternating) set.add(personId);
    }
    return set;
  }, [anchorsByPersonId]);

  const week = useWeekActivities(weekStart, personFilter);

  // Dialog state — mirror the events page pattern.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Activity | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Activity | null>(null);

  // Per-occurrence action menu (cancel / reschedule / restore / jump to edit).
  // Opened by clicking a block in the grid — the previous behavior of
  // jumping straight to the activity-edit dialog now lives inside this
  // menu as the "Izmeni aktivnost" option.
  const [actionBlock, setActionBlock] = React.useState<ResolvedActivityBlock | null>(null);

  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();
  const replaceSchedule = useReplaceActivitySchedule();
  const replaceParticipants = useReplaceActivityParticipants();
  const participantsQuery = useActivityParticipants();

  const activities = activitiesQuery.data ?? [];
  const schedule = scheduleQuery.data ?? [];
  const participants = participantsQuery.data ?? [];

  const activitiesById = React.useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities],
  );
  const peopleById = React.useMemo(() => new Map(members.map((p) => [p.id, p])), [members]);

  // Person ids per activity — used by AllActivitiesList for the chip
  // strip and by the edit dialog to prefill `existingPersonIds`.
  const personIdsByActivity = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of participants) {
      const arr = map.get(p.activity_id);
      if (arr) arr.push(p.person_id);
      else map.set(p.activity_id, [p.person_id]);
    }
    return map;
  }, [participants]);

  const togglePerson = (personId: string) => {
    setPersonFilter((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  const goToToday = () => setWeekStart(getThisWeekStart());
  const goPrevWeek = () =>
    setWeekStart((current) => format(addDays(parseISO(current + "T12:00:00"), -7), "yyyy-MM-dd"));
  const goNextWeek = () =>
    setWeekStart((current) => format(addDays(parseISO(current + "T12:00:00"), 7), "yyyy-MM-dd"));

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (activity: Activity) => {
    setEditing(activity);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: ActivityFormPayload) => {
    setFormError(null);
    try {
      const { rules, person_ids, ...activityPayload } = payload;
      let activityId: string;
      if (editing) {
        await updateActivity.mutateAsync({ id: editing.id, payload: activityPayload });
        activityId = editing.id;
      } else {
        const created = await createActivity.mutateAsync(activityPayload);
        activityId = created.id;
      }
      await replaceSchedule.mutateAsync({ activityId, rules });
      await replaceParticipants.mutateAsync({ activityId, personIds: person_ids });
      setDialogOpen(false);
      setEditing(null);
    } catch (err) {
      const fallback = editing
        ? "Greška pri ažuriranju aktivnosti"
        : "Greška pri kreiranju aktivnosti";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const confirmDelete = (activity: Activity) => {
    setToDelete(activity);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!toDelete) return;
    try {
      await deleteActivity.mutateAsync(toDelete.id);
      setDeleteDialogOpen(false);
      setToDelete(null);
    } catch {
      // Toast surfaced by the hook; keep the dialog open for retry.
    }
  };

  const handleBlockClick = (block: ResolvedActivityBlock) => {
    setActionBlock(block);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditing(null);
      setFormError(null);
    }
  };

  const editingRules = editing
    ? schedule.filter((rule) => rule.activity_id === editing.id)
    : undefined;
  const editingPersonIds = editing ? personIdsByActivity.get(editing.id) : undefined;

  const rangeLabel = formatWeekRange(weekStart);
  const isCurrentWeek = weekStart === getThisWeekStart();
  const isLoading =
    activitiesQuery.isLoading || scheduleQuery.isLoading || participantsQuery.isLoading;
  const saving =
    createActivity.isPending ||
    updateActivity.isPending ||
    replaceSchedule.isPending ||
    replaceParticipants.isPending;

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Aktivnosti</h1>
        <div className="flex flex-wrap items-center gap-2">
          {members.length > 0 ? <ColorAssignmentPopover members={members} /> : null}
          <Button onClick={openAdd}>
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj aktivnost
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={goPrevWeek}
            className="rounded-l-md p-2 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Prethodna nedelja"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="border-x border-gray-200 px-3 py-1.5 text-sm font-medium tabular-nums dark:border-gray-700">
            {rangeLabel}
          </div>
          <button
            type="button"
            onClick={goNextWeek}
            className="rounded-r-md p-2 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Sledeća nedelja"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        {!isCurrentWeek ? (
          <Button variant="outline" size="sm" onClick={goToToday}>
            Ova sedmica
          </Button>
        ) : null}
      </div>

      {members.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {members.map((member) => (
            <PersonChip
              key={member.id}
              person={member}
              active={personFilter.size === 0 || personFilter.has(member.id)}
              onToggle={() => togglePerson(member.id)}
            />
          ))}
          {personFilter.size > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setPersonFilter(new Set())}
            >
              Resetuj
            </Button>
          ) : null}
        </div>
      ) : null}

      <ShiftControls
        members={members}
        anchorsByPersonId={anchorsByPersonId}
        shiftsByPerson={week.shiftsByPerson}
      />

      {isLoading ? (
        <div className="text-gray-500">Učitavanje…</div>
      ) : (
        <WeekGrid
          weekStart={weekStart}
          blocks={week.blocks}
          activitiesById={activitiesById}
          peopleById={peopleById}
          onBlockClick={handleBlockClick}
        />
      )}

      {!isLoading && activities.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          Još uvek nema aktivnosti. Dodaj prvu — trening, časove, muzičku ili šta god ide redovno
          tokom nedelje.
        </div>
      ) : null}

      {activities.length > 0 ? (
        <AllActivitiesList
          activities={activities}
          scheduleCountByActivity={countSchedule(schedule)}
          personIdsByActivity={personIdsByActivity}
          peopleById={peopleById}
          onEdit={openEdit}
          onDelete={confirmDelete}
        />
      ) : null}

      <ActivityFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        activity={editing}
        existingRules={editingRules}
        existingPersonIds={editingPersonIds}
        people={members}
        peopleWithShift={peopleWithShift}
        defaultPersonId={profile?.id ?? null}
        error={formError}
        saving={saving}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setToDelete(null);
        }}
        title="Obriši aktivnost"
        message={`Da li ste sigurni da želite da obrišete "${toDelete?.name ?? ""}"?`}
        loading={deleteActivity.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />

      <BlockActionDialog
        open={!!actionBlock}
        onOpenChange={(open) => {
          if (!open) setActionBlock(null);
        }}
        block={actionBlock}
        activity={actionBlock ? activitiesById.get(actionBlock.activityId) : undefined}
        person={actionBlock ? peopleById.get(actionBlock.personId) : undefined}
        onEditActivity={openEdit}
      />
    </div>
  );
}

function countSchedule(schedule: ReadonlyArray<{ activity_id: string }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const rule of schedule) {
    map.set(rule.activity_id, (map.get(rule.activity_id) ?? 0) + 1);
  }
  return map;
}

function formatWeekRange(weekStart: string): string {
  const start = parseISO(weekStart + "T12:00:00");
  const end = addDays(start, 6);
  return `${format(start, "dd.MM", { locale: srLocale })} – ${format(end, "dd.MM.yyyy", {
    locale: srLocale,
  })}`;
}

interface AllActivitiesListProps {
  activities: ReadonlyArray<Activity>;
  scheduleCountByActivity: ReadonlyMap<string, number>;
  personIdsByActivity: ReadonlyMap<string, string[]>;
  peopleById: ReadonlyMap<string, Profile>;
  onEdit: (activity: Activity) => void;
  onDelete: (activity: Activity) => void;
}

function AllActivitiesList({
  activities,
  scheduleCountByActivity,
  personIdsByActivity,
  peopleById,
  onEdit,
  onDelete,
}: AllActivitiesListProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Sve aktivnosti
      </h2>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {activities.map((activity) => {
          const personIds = personIdsByActivity.get(activity.id) ?? [];
          const personNames = personIds
            .map((id) => {
              const p = peopleById.get(id);
              return p
                ? getDisplayName({
                    firstName: p.first_name,
                    lastName: p.last_name,
                    email: null,
                  }) || "Bez imena"
                : "—";
            })
            .join(", ");
          const count = scheduleCountByActivity.get(activity.id) ?? 0;
          return (
            <li
              key={activity.id}
              className={cn(
                "flex items-center gap-3 py-2",
                activity.is_paused && "opacity-60",
              )}
            >
              <span className="flex shrink-0 -space-x-1">
                {personIds.length === 0 ? (
                  <span className="inline-block size-2.5 rounded-full bg-gray-300" aria-hidden />
                ) : (
                  personIds.map((id) => {
                    const p = peopleById.get(id);
                    const color = p?.color ?? fallbackColorForProfile(id);
                    return (
                      <span
                        key={id}
                        className="inline-block size-2.5 rounded-full ring-1 ring-white dark:ring-gray-800"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      />
                    );
                  })
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {activity.name}
                  {activity.is_paused ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">
                      pauzirano
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {personNames || "Bez učesnika"} ·{" "}
                  {count === 0 ? "bez termina" : count === 1 ? "1 termin" : `${count} termina`}
                  {activity.active_from || activity.active_to ? (
                    <span>
                      {" · "}
                      {activity.active_from ? formatDate(activity.active_from) : "…"}
                      {" – "}
                      {activity.active_to ? formatDate(activity.active_to) : "…"}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                aria-label="Izmeni"
                onClick={() => onEdit(activity)}
                className="rounded-md p-2 text-muted-foreground hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              >
                <PencilSquareIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Obriši"
                onClick={() => onDelete(activity)}
                className="rounded-md p-2 text-muted-foreground hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-700"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

