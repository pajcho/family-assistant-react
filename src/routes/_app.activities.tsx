import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpenIcon,
  Cog6ToothIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { addDays, format, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import { AddButton } from "@/components/common/AddButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PeriodPickerShell } from "@/components/common/PeriodPicker";
import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog";
import { ActivityOptionsSheet } from "@/components/activities/ActivityOptionsSheet";
import { BlockActionDialog } from "@/components/activities/BlockActionDialog";
import { PersonChip } from "@/components/activities/PersonChip";
import { TimetableEditor } from "@/components/activities/TimetableEditor";
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
import { useBellSchedule } from "@/hooks/useBellSchedule";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useSchoolTimetable } from "@/hooks/useSchoolTimetable";
import { useWeekActivities } from "@/hooks/useWeekActivities";
import { useWeekSchool } from "@/hooks/useWeekSchool";
import type { Activity, Profile, SchoolShift, TimetableVariant } from "@/types/database";
import { fallbackColorForProfile, getThisWeekStart } from "@/utils/activity";
import { timeBandForWeek } from "@/utils/schoolTimetable";
import { formatDate, srLocale } from "@/utils/date";
import { cn } from "@/lib/cn";
import { getDisplayName } from "@/utils/identity";

export const Route = createFileRoute("/_app/activities")({
  // `?edit=<activityId>` deep-links the edit form open — used by the
  // dashboard's "Izmeni aktivnost" so it lands here with the dialog already
  // showing instead of dumping the user on the page.
  validateSearch: (search: Record<string, unknown>): { edit?: string } => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
  component: ActivitiesPage,
});

function ActivitiesPage() {
  const { profile } = useProfile();
  const { members } = useFamilyMembers();
  const activitiesQuery = useActivities();
  const scheduleQuery = useActivitySchedule();
  const { byPersonId: anchorsByPersonId } = useSchoolShiftAnchors();

  const { edit: editId } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [weekStart, setWeekStart] = useState<string>(() => getThisWeekStart());
  const [personFilter, setPersonFilter] = useState<Set<string>>(() => new Set());
  // A/B patterns are only meaningful when the person's rota actually
  // alternates. A child with a single, never-changing timetable
  // (is_alternating=false) has nothing to alternate between — their
  // activities are coerced to fire every week. (1st/2nd graders DO alternate
  // their rota — they just have a fixed morning time band — so they stay in.)
  const peopleWithShift = useMemo(() => {
    const set = new Set<string>();
    for (const [personId, anchor] of anchorsByPersonId) {
      if (anchor.is_alternating) set.add(personId);
    }
    return set;
  }, [anchorsByPersonId]);

  const week = useWeekActivities(weekStart, personFilter);
  const school = useWeekSchool(weekStart, personFilter);
  const { bell } = useBellSchedule();
  const timetableQuery = useSchoolTimetable();

  // School view controls.
  const [showSchool, setShowSchool] = useState(true);
  const [timetableMemberId, setTimetableMemberId] = useState<string | null>(null);
  // Column to pre-select when the editor opens from a school-block click —
  // the block's shift variant + weekday. Null when opened any other way.
  const [timetableInitial, setTimetableInitial] = useState<{
    variant: TimetableVariant;
    day: number;
  } | null>(null);
  // "Opcije" sheet — a self-contained hub; the timetable also opens directly
  // from a grid click via `timetableMemberId`.
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Resolved time band per child for the displayed week — drives the sun/moon
  // badge on the filter chips and the shift label in the options sheet.
  const timeBandByPerson = useMemo(() => {
    const map = new Map<string, SchoolShift>();
    for (const [personId, anchor] of anchorsByPersonId) {
      map.set(personId, timeBandForWeek(anchor, weekStart));
    }
    return map;
  }, [anchorsByPersonId, weekStart]);

  // Dialog state — mirror the events page pattern.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Activity | null>(null);

  // Per-occurrence action menu (cancel / reschedule / restore / jump to edit).
  // Opened by clicking a block in the grid — the previous behavior of
  // jumping straight to the activity-edit dialog now lives inside this
  // menu as the "Izmeni aktivnost" option.
  const [actionBlock, setActionBlock] = useState<ResolvedActivityBlock | null>(null);

  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();
  const replaceSchedule = useReplaceActivitySchedule();
  const replaceParticipants = useReplaceActivityParticipants();
  const participantsQuery = useActivityParticipants();

  const activities = useMemo(() => activitiesQuery.data ?? [], [activitiesQuery.data]);
  const schedule = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data]);
  const participants = useMemo(() => participantsQuery.data ?? [], [participantsQuery.data]);

  const activitiesById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const peopleById = useMemo(() => new Map(members.map((p) => [p.id, p])), [members]);

  // Person ids per activity — used by AllActivitiesList for the chip
  // strip and by the edit dialog to prefill `existingPersonIds`.
  const personIdsByActivity = useMemo(() => {
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

  // Dashboard "Izmeni aktivnost" deep-link: open the edit dialog for the
  // activity in `?edit`, then strip the param so it won't reopen on a
  // re-render or back navigation. Waits for activities + schedule +
  // participants to load so the form opens with its termini and učesnici
  // already populated; clears the param even if the id is stale (deleted).
  useEffect(() => {
    if (!editId) return;
    if (activitiesQuery.isLoading || scheduleQuery.isLoading || participantsQuery.isLoading) return;
    const activity = activitiesById.get(editId);
    if (activity) {
      setEditing(activity);
      setFormError(null);
      setDialogOpen(true);
    }
    void navigate({ search: (prev) => ({ ...prev, edit: undefined }), replace: true });
  }, [
    editId,
    activitiesQuery.isLoading,
    scheduleQuery.isLoading,
    participantsQuery.isLoading,
    activitiesById,
    navigate,
  ]);

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
  const timetableMember = timetableMemberId ? (peopleById.get(timetableMemberId) ?? null) : null;

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
      <div className="flex flex-row items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Aktivnosti</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => setOptionsOpen(true)} aria-label="Opcije">
            <Cog6ToothIcon className="h-5 w-5 sm:mr-2" />
            <span className="hidden sm:inline">Opcije</span>
          </Button>
          <AddButton label="Dodaj aktivnost" onClick={openAdd} />
        </div>
      </div>

      {/* Sticky just under the app header (h-14) so the week navigation + school
          toggle stay put while the grid below scrolls. */}
      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-2 bg-gray-50 py-2 dark:bg-gray-900">
        <PeriodPickerShell
          onPrev={goPrevWeek}
          onNext={goNextWeek}
          prevAriaLabel="Prethodna nedelja"
          nextAriaLabel="Sledeća nedelja"
        >
          <div className="flex items-center border-x border-gray-200 px-3 py-1.5 text-sm font-medium tabular-nums dark:border-gray-700">
            {rangeLabel}
          </div>
        </PeriodPickerShell>
        {!isCurrentWeek ? (
          <Button variant="outline" size="sm" onClick={goToToday}>
            Ova sedmica
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowSchool((v) => !v)}
          aria-pressed={showSchool}
          aria-label="Prikaži školu"
          title="Prikaži školu"
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
            showSchool
              ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
              : "border-gray-200 text-muted-foreground hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800",
          )}
        >
          <BookOpenIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Prikaži školu</span>
        </button>
      </div>

      {members.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {members.map((member) => (
            <PersonChip
              key={member.id}
              person={member}
              active={personFilter.size === 0 || personFilter.has(member.id)}
              onToggle={() => togglePerson(member.id)}
              shift={timeBandByPerson.get(member.id) ?? null}
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

      {isLoading ? (
        <div className="text-gray-500">Učitavanje…</div>
      ) : (
        <WeekGrid
          weekStart={weekStart}
          blocks={week.blocks}
          schoolBlocks={showSchool ? school.blocks : []}
          activitiesById={activitiesById}
          peopleById={peopleById}
          onBlockClick={handleBlockClick}
          onSchoolBlockClick={(block) => {
            setTimetableMemberId(block.personId);
            setTimetableInitial({ variant: block.variant, day: block.dayOfWeek });
          }}
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

      {/* Direct timetable edit from clicking a school block on the grid. */}
      {timetableMember ? (
        <TimetableEditor
          open={!!timetableMemberId}
          onOpenChange={(open) => {
            if (!open) {
              setTimetableMemberId(null);
              setTimetableInitial(null);
            }
          }}
          member={timetableMember}
          anchor={anchorsByPersonId.get(timetableMember.id)}
          entries={timetableQuery.data ?? []}
          bell={bell}
          initialVariant={timetableInitial?.variant}
          initialDay={timetableInitial?.day}
        />
      ) : null}

      <ActivityOptionsSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        members={members}
        anchorsByPersonId={anchorsByPersonId}
        timeBandByPerson={timeBandByPerson}
        entries={timetableQuery.data ?? []}
        bell={bell}
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
              className={cn("flex items-center gap-3 py-2", activity.is_paused && "opacity-60")}
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
