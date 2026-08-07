import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
  Squares2X2Icon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { addDays, format, parseISO } from "date-fns";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { IconButton } from "@/components/common/IconButton";
import {
  ItemCard,
  ItemMain,
  ItemMeta,
  ItemSide,
  ItemTile,
  PersonDot,
} from "@/components/common/ItemCard";
import { Pill } from "@/components/common/Pill";
import { SectionHeading } from "@/components/common/SectionHeading";
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
import { getDisplayName } from "@/utils/identity";

export const Route = createFileRoute("/_app/activities")({
  // `?edit=<activityId>` deep-links the edit form open - used by the
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
  // (is_alternating=false) has nothing to alternate between - their
  // activities are coerced to fire every week. (1st/2nd graders DO alternate
  // their rota - they just have a fixed morning time band - so they stay in.)
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
  // Column to pre-select when the editor opens from a school-block click -
  // the block's shift variant + weekday. Null when opened any other way.
  const [timetableInitial, setTimetableInitial] = useState<{
    variant: TimetableVariant;
    day: number;
  } | null>(null);
  // "Opcije" sheet - a self-contained hub; the timetable also opens directly
  // from a grid click via `timetableMemberId`.
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Resolved time band per child for the displayed week - drives the sun/moon
  // badge on the filter chips and the shift label in the options sheet.
  const timeBandByPerson = useMemo(() => {
    const map = new Map<string, SchoolShift>();
    for (const [personId, anchor] of anchorsByPersonId) {
      map.set(personId, timeBandForWeek(anchor, weekStart));
    }
    return map;
  }, [anchorsByPersonId, weekStart]);

  // Dialog state - mirror the events page pattern.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  // Starter-chip prefill ("+ Trening" on the empty grid overlay).
  const [addInitialName, setAddInitialName] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Activity | null>(null);

  // Per-occurrence action menu (cancel / reschedule / restore / jump to edit).
  // Opened by clicking a block in the grid - the previous behavior of
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

  // Person ids per activity - used by AllActivitiesList for the chip
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
    setAddInitialName(null);
    setDialogOpen(true);
  };

  const openAddWithName = (name: string) => {
    setEditing(null);
    setFormError(null);
    setAddInitialName(name);
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
      setAddInitialName(null);
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

  const hasSchoolChip = school.blocks.length > 0;
  const hasMemberChips = members.length > 1;

  const header = (
    <div className="flex flex-col gap-2.5">
      <ScreenHeaderRow
        title="Aktivnosti"
        actions={
          <>
            <IconButton
              icon={Cog6ToothIcon}
              aria-label="Opcije"
              onClick={() => setOptionsOpen(true)}
            />
            <IconButton icon={PlusIcon} aria-label="Dodaj aktivnost" onClick={openAdd} />
          </>
        }
      />
      <div className="flex items-center gap-2">
        <IconButton icon={ChevronLeftIcon} aria-label="Prethodna nedelja" onClick={goPrevWeek} />
        <div className="flex-1 text-center text-sm font-bold tabular-nums">{rangeLabel}</div>
        <IconButton icon={ChevronRightIcon} aria-label="Sledeća nedelja" onClick={goNextWeek} />
      </div>
      {hasSchoolChip || !isCurrentWeek || hasMemberChips ? (
        <FilterChipRow ariaLabel="Filteri rasporeda">
          {/* Only once a school timetable actually exists (same gate as the
              Kalendar week view) - school is set up via Opcije, not this chip. */}
          {hasSchoolChip ? (
            <FilterChip
              active={showSchool}
              onToggle={() => setShowSchool((v) => !v)}
              icon={BookOpenIcon}
            >
              Prikaži školu
            </FilterChip>
          ) : null}
          {!isCurrentWeek ? (
            <FilterChip active={false} onToggle={goToToday} icon={ClockIcon}>
              Ova sedmica
            </FilterChip>
          ) : null}
          {hasMemberChips && (hasSchoolChip || !isCurrentWeek) ? (
            <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
          ) : null}
          {/* "Sve" carries the neutral state so the member chips only light up
              once someone is actually picked (same reading as Kalendar). One
              member = nobody to narrow to, so the whole group stays hidden. */}
          {hasMemberChips ? (
            <FilterChip
              active={personFilter.size === 0}
              onToggle={() => setPersonFilter(new Set())}
            >
              Sve
            </FilterChip>
          ) : null}
          {hasMemberChips
            ? members.map((member) => (
                <PersonChip
                  key={member.id}
                  person={member}
                  active={personFilter.has(member.id)}
                  onToggle={() => togglePerson(member.id)}
                  shift={timeBandByPerson.get(member.id) ?? null}
                />
              ))
            : null}
        </FilterChipRow>
      ) : null}
    </div>
  );

  return (
    <AppScreen header={header} contentClassName="mx-auto w-full max-w-3xl space-y-4">
      {isLoading ? (
        <p className="text-muted-foreground">Učitavanje…</p>
      ) : (
        // The starter overlay floats over the (faint, still visible) week grid -
        // a bare 07-22h grid with no explanation reads as broken to a new user.
        <div className="relative">
          <WeekGrid
            weekStart={weekStart}
            blocks={week.blocks}
            schoolBlocks={showSchool ? school.blocks : []}
            // Not gated on there being any class left: during the summer break
            // the school toggle has nothing to toggle, and the label is the
            // only thing explaining why the columns are bare.
            breakDays={showSchool ? school.breakDays : undefined}
            activitiesById={activitiesById}
            peopleById={peopleById}
            onBlockClick={handleBlockClick}
            onSchoolBlockClick={(block) => {
              setTimetableMemberId(block.personId);
              setTimetableInitial({ variant: block.variant, day: block.dayOfWeek });
            }}
          />
          {/* AFTER the grid in DOM so it paints above its sticky gutter/header. */}
          {activities.length === 0 ? (
            <EmptyState
              variant="overlay"
              icon={Squares2X2Icon}
              tone="violet"
              title="Trening, muzička, engleski..."
              description="Unesi nedeljni raspored jednom - ponavlja se sam, a izmene rešavaš izuzecima."
              action={{ label: "Dodaj aktivnost", onClick: openAdd }}
              examples={["Trening", "Muzička", "Engleski"].map((name) => ({
                label: name,
                onClick: () => openAddWithName(name),
              }))}
            />
          ) : null}
        </div>
      )}

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
        initialName={addInitialName ?? undefined}
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
    </AppScreen>
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
  return `${format(start, "dd.MM", { locale: srLocale })} - ${format(end, "dd.MM.yyyy", {
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
    <section>
      <SectionHeading count={activities.length} className="mb-2">
        Sve aktivnosti
      </SectionHeading>
      <ul className="space-y-2.5">
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
                : "-";
            })
            .join(", ");
          const count = scheduleCountByActivity.get(activity.id) ?? 0;
          // The tile takes the FIRST participant's colour - with siblings in
          // one activity the dots after the name carry the rest.
          const firstPersonId = personIds[0];
          const tileColor = firstPersonId
            ? (peopleById.get(firstPersonId)?.color ?? fallbackColorForProfile(firstPersonId))
            : undefined;
          const meta = [
            personNames || "Bez učesnika",
            count === 0 ? "bez termina" : count === 1 ? "1 termin" : `${count} termina`,
            activity.active_from || activity.active_to
              ? `${activity.active_from ? formatDate(activity.active_from) : "…"} - ${
                  activity.active_to ? formatDate(activity.active_to) : "…"
                }`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <li key={activity.id}>
              <ItemCard dimmed={activity.is_paused}>
                <ItemTile icon={SparklesIcon} color={tileColor} tone="accent" />
                <ItemMain>
                  <span className="flex flex-wrap items-center gap-1.5 text-[15px] leading-[1.25] font-semibold tracking-[-0.01em]">
                    <span className="min-w-0 truncate">{activity.name}</span>
                    {personIds.map((id) => (
                      <PersonDot
                        key={id}
                        color={peopleById.get(id)?.color ?? fallbackColorForProfile(id)}
                      />
                    ))}
                    {activity.is_paused ? <Pill tone="warn">pauzirano</Pill> : null}
                  </span>
                  <ItemMeta>
                    <span className="min-w-0 truncate">{meta}</span>
                  </ItemMeta>
                </ItemMain>
                <ItemSide className="flex-row items-center gap-0.5">
                  <IconButton
                    icon={PencilSquareIcon}
                    size="sm"
                    aria-label={`Izmeni ${activity.name}`}
                    onClick={() => onEdit(activity)}
                  />
                  <IconButton
                    icon={TrashIcon}
                    size="sm"
                    aria-label={`Obriši ${activity.name}`}
                    onClick={() => onDelete(activity)}
                    className="text-neg"
                  />
                </ItemSide>
              </ItemCard>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
