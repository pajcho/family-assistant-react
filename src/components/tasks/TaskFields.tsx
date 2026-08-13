import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ArrowPathIcon, ClockIcon, UsersIcon } from "@heroicons/react/24/outline";

import { DateField } from "@/components/common/DateField";
import { Chip, ChipRow, FieldGroupLabel, FieldHint } from "@/components/common/FormControls";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import { OptionPickerRow } from "@/components/common/OptionPickerRow";
import { PickerOverlay } from "@/components/common/PickerOverlay";
import { PickerRow } from "@/components/common/PickerRow";
import { SwitchRow } from "@/components/common/SwitchRow";
import { TimeField } from "@/components/common/TimeField";
import { ReminderSelect } from "@/components/ui/reminder-select";
import {
  DAILY_INTERVAL_OPTIONS,
  MONTHLY_INTERVAL_OPTIONS,
  TASK_DAY_REMINDER_OPTIONS,
  TASK_RECURRENCE_OPTIONS,
  TASK_TIME_REMINDER_OPTIONS,
  WEEKLY_INTERVAL_OPTIONS,
  taskRecurrenceSummary,
  type TaskDraft,
} from "@/components/tasks/taskDraft";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile } from "@/hooks/useProfile";
import { DAY_LABELS_SHORT } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { pluralSr } from "@/utils/plural";
import type { ListScope } from "@/types/database";

/**
 * The editors for a task draft's optional dimensions - one sheet body per
 * dimension, plus the everything-at-once variant the global "+ → Zadatak" sheet
 * uses.
 *
 * Shared by the two ways in - the on-screen `TaskComposer`, which opens them one
 * at a time as overlays, and the quick-add sheet, which is itself the form - so a
 * date set from the bottom bar and a date set inside a list go through exactly the
 * same control and produce exactly the same row. The draft shape and its
 * read-back strings are `taskDraft.ts`.
 */

/** "Samo ja" / "Ana" / "Ana, Marko" / "3 osobe" / "5 osoba" - the who chip's read-back. */
export function useTaskAssigneeSummary(draft: TaskDraft): string | null {
  const { byId } = useFamilyMembers();
  // Private beats the name: "Samo ja" is the thing worth reading back from a
  // collapsed composer, and printing the author's own name instead would say
  // nothing about who can SEE it.
  if (draft.onlyMe) return "Samo ja";
  if (draft.assigneeIds.length === 0) return null;
  if (draft.assigneeIds.length > 2) {
    const count = draft.assigneeIds.length;
    return `${count} ${pluralSr(count, "osoba", "osobe", "osoba")}`;
  }
  return draft.assigneeIds
    .map((id) => {
      const person = byId.get(id);
      return (
        getDisplayName({
          firstName: person?.first_name ?? null,
          lastName: person?.last_name ?? null,
          email: null,
        }) || "Član"
      );
    })
    .join(", ");
}

/**
 * Fills in the self-assignment a private draft is supposed to carry, once the
 * viewer's profile id is actually known.
 *
 * `privateDraftDefaults` fails closed: it turns "Samo ja" on even when the
 * profile query is still in flight, because a task that is private without an
 * assignee is right, and one that is family-wide by accident is not. That
 * leaves the assignee to fill in afterwards - which is this, and it only ever
 * touches a draft that is STILL the untouched private default, so it can never
 * overwrite a choice somebody made in between.
 */
export function useSelfAssignWhenPrivate(setDraft: Dispatch<SetStateAction<TaskDraft>>) {
  const viewerId = useProfile().profile?.id ?? null;
  useEffect(() => {
    if (!viewerId) return;
    setDraft((s) =>
      s.onlyMe && s.assigneeIds.length === 0 ? { ...s, assigneeIds: [viewerId] } : s,
    );
  }, [viewerId, setDraft]);
}

/* ------------------------------------------------------------------------- */
/* Sheet bodies                                                               */
/* ------------------------------------------------------------------------- */

export type TaskFieldsProps = {
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>>;
};

/**
 * "Datum": the day, then the optional clock. Both are `PickerRow`s that open
 * their own overlay on top, so the sheet itself stays exactly as tall as its two
 * rows. Clearing the date clears the time with it - a time without a date is
 * meaningless and the database rejects it.
 */
export function TaskDateSheetBody({ draft, setDraft }: TaskFieldsProps) {
  return (
    <div className="flex flex-col gap-2">
      <DateField
        label="Rok"
        value={draft.dueDate}
        onChange={(dueDate) =>
          setDraft((s) => ({
            ...s,
            dueDate,
            dueTime: dueDate ? s.dueTime : null,
            remindDaysBefore: dueDate ? s.remindDaysBefore : null,
            remindMinutesBefore: dueDate ? s.remindMinutesBefore : null,
          }))
        }
        mode="future"
        placeholder="Bez datuma"
        clearable
      />
      <TimeField
        label="Vreme"
        value={draft.dueTime}
        onChange={(dueTime) => setDraft((s) => ({ ...s, dueTime }))}
        disabled={!draft.dueDate}
        clearable
        icon={<ClockIcon className="size-[17px]" aria-hidden="true" />}
      />
      <FieldHint>
        {draft.dueDate
          ? "Bez vremena zadatak stoji u dnevnom pregledu, ne u satnici."
          : "Zadatak bez datuma živi samo u svojoj listi."}
      </FieldHint>
    </div>
  );
}

export type TaskWhoSheetBodyProps = TaskFieldsProps & {
  /**
   * Scope of the list the task is going into, or null when it has none. A list
   * owns its tasks' visibility (a trigger forces it), so any list at all takes
   * the "Samo ja" switch out of the person's hands - the hint then says what
   * the list decided on their behalf.
   */
  listScope?: ListScope | null;
};

/**
 * "Za koga": "Samo ja" first, then the assignee pills. Nobody selected means
 * family-wide.
 *
 * The private switch lives IN the roster row rather than above it because it
 * answers the same question the pills do, and because the two are exclusive in
 * practice: a task only you can see has nobody else to be for.
 */
export function TaskWhoSheetBody({ draft, setDraft, listScope = null }: TaskWhoSheetBodyProps) {
  const viewerId = useProfile().profile?.id ?? null;
  const listed = listScope !== null;

  const setOnlyMe = (next: boolean) => {
    setDraft((s) => {
      if (next) return { ...s, onlyMe: true, assigneeIds: viewerId ? [viewerId] : [] };
      // Turning it off undoes exactly what turning it on did - the self
      // assignment it added - and leaves alone anything chosen by hand.
      const selfOnly =
        viewerId !== null && s.assigneeIds.length === 1 && s.assigneeIds[0] === viewerId;
      return { ...s, onlyMe: false, assigneeIds: selfOnly ? [] : s.assigneeIds };
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <MemberMultiSelect
        label="Za koga"
        hint={whoHint(listScope, draft.onlyMe)}
        value={draft.assigneeIds}
        disabled={listScope === "personal"}
        leading={
          <Chip
            selected={!listed && draft.onlyMe}
            disabled={listed}
            onClick={() => setOnlyMe(!draft.onlyMe)}
          >
            Samo ja
          </Chip>
        }
        onChange={(assigneeIds) =>
          setDraft((s) => ({
            ...s,
            assigneeIds,
            // Handing the task to somebody else - or dropping yourself - is the
            // other way out of private, and the only one that needs no explaining.
            onlyMe:
              s.onlyMe &&
              assigneeIds.length === 1 &&
              viewerId !== null &&
              assigneeIds[0] === viewerId,
          }))
        }
      />
    </div>
  );
}

/** What the line under the pills says about who ends up seeing the task. */
function whoHint(listScope: ListScope | null, onlyMe: boolean): string {
  if (listScope === "personal")
    return "Lista je lična, pa zadatak vidiš samo ti - i nema kome da se dodeli.";
  if (listScope === "family")
    return "Lista je porodična, pa zadatak vide svi. Dete vidi samo ono što mu je dodeljeno.";
  if (onlyMe) return "Vidiš ga samo ti. Niko drugi u porodici ga ne vidi.";
  return "Vide ga svi u porodici. Dete vidi samo ono što mu je dodeljeno.";
}

/**
 * "Ponavljanje": the period, then everything conditioned on it. Needs a date to
 * count from, so without one it says so instead of offering a rule that could
 * never fire.
 */
export function TaskRecurrenceSheetBody({ draft, setDraft }: TaskFieldsProps) {
  const period = draft.recurrencePeriod;
  const intervalOptions =
    period === "daily"
      ? DAILY_INTERVAL_OPTIONS
      : period === "weekly"
        ? WEEKLY_INTERVAL_OPTIONS
        : MONTHLY_INTERVAL_OPTIONS;

  if (!draft.dueDate) {
    return (
      <p className="text-sm font-normal text-muted-foreground">
        Ponavljanje se računa od roka, pa prvo izaberi datum.
      </p>
    );
  }

  const toggleWeekday = (day: number) => {
    setDraft((s) => {
      const set = new Set(s.recurrenceWeekdays);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...s, recurrenceWeekdays: [...set].sort((a, b) => a - b) };
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Two rows rather than four full-width buttons and a native <select>: the
          options are worth a screen only while somebody is choosing, and a
          native picker on iOS covers the form it belongs to. */}
      <OptionPickerRow
        title="Ponavljanje"
        icon={<ArrowPathIcon className="size-[17px]" aria-hidden="true" />}
        value={period}
        options={TASK_RECURRENCE_OPTIONS}
        onChange={(recurrencePeriod) =>
          setDraft((s) => ({
            ...s,
            recurrencePeriod,
            // Always back to 1: the weekly and monthly scales do not share
            // a meaning, and for one-time it is ignored on submit.
            recurrenceInterval: 1,
            recurrenceWeekdays: recurrencePeriod === "weekly" ? s.recurrenceWeekdays : [],
            recurrenceUntil: recurrencePeriod === "one-time" ? null : s.recurrenceUntil,
          }))
        }
      />

      {period !== "one-time" ? (
        <OptionPickerRow
          title="Na koliko"
          value={draft.recurrenceInterval}
          options={intervalOptions}
          onChange={(recurrenceInterval) => setDraft((s) => ({ ...s, recurrenceInterval }))}
        />
      ) : null}

      {period === "weekly" ? (
        <div className="mt-2">
          <FieldGroupLabel>Dani u nedelji</FieldGroupLabel>
          <ChipRow role="group" aria-label="Dani u nedelji">
            {DAY_LABELS_SHORT.map((label, day) => (
              <Chip
                key={label}
                selected={draft.recurrenceWeekdays.includes(day)}
                onClick={() => toggleWeekday(day)}
              >
                {label}
              </Chip>
            ))}
          </ChipRow>
          <FieldHint>Bez izbora ponavlja se onim danom kojim rok pada.</FieldHint>
        </div>
      ) : null}

      {period !== "one-time" ? (
        <DateField
          label="Do datuma"
          value={draft.recurrenceUntil}
          onChange={(recurrenceUntil) => setDraft((s) => ({ ...s, recurrenceUntil }))}
          mode="future"
          placeholder="Bez kraja"
          minDate={draft.dueDate}
          clearable
        />
      ) : null}

      {/* Who a tick speaks for - the only question a repeat adds to a chore that
          belongs to more than one person, and the only place the two completion
          modes differ at all. A one-off is answered by a single `is_completed`,
          and one assignee's own copy IS the whole occurrence, so the switch
          simply is not there in either case. */}
      {period !== "one-time" && draft.assigneeIds.length > 1 ? (
        <SwitchRow
          icon={UsersIcon}
          title="Svako štriklira svoje"
          description={
            draft.completionMode === "per_assignee"
              ? "Svako ima svoj kvadratić - zadatak je gotov tek kada ga svi označe."
              : "Dovoljno je da jedno označi i gotovo je za sve, do sledećeg ponavljanja."
          }
          checked={draft.completionMode === "per_assignee"}
          onChange={(next) =>
            setDraft((s) => ({ ...s, completionMode: next ? "per_assignee" : "shared" }))
          }
        />
      ) : null}
    </div>
  );
}

/**
 * "Podsetnik": days before for an all-day task, minutes before for a timed one -
 * the same split events and payments already make, because those are the two
 * units `send-due-pushes` can fire on.
 */
export function TaskReminderSheetBody({ draft, setDraft }: TaskFieldsProps) {
  if (!draft.dueDate) {
    return (
      <p className="text-sm font-normal text-muted-foreground">
        Podsetnik se šalje pre roka, pa prvo izaberi datum.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <FieldGroupLabel>
        <label htmlFor="task-reminder">Podsetnik</label>
      </FieldGroupLabel>
      {draft.dueTime ? (
        <ReminderSelect
          id="task-reminder"
          value={draft.remindMinutesBefore}
          onChange={(remindMinutesBefore) => setDraft((s) => ({ ...s, remindMinutesBefore }))}
          options={TASK_TIME_REMINDER_OPTIONS}
        />
      ) : (
        <ReminderSelect
          id="task-reminder"
          value={draft.remindDaysBefore}
          onChange={(remindDaysBefore) => setDraft((s) => ({ ...s, remindDaysBefore }))}
          options={TASK_DAY_REMINDER_OPTIONS}
        />
      )}
      <FieldHint>
        {draft.dueTime
          ? "Push stiže svima u porodici koji su uključili obaveštenja."
          : "Zadatak bez vremena javlja se ujutru, u vreme dnevnog pregleda."}
      </FieldHint>
    </div>
  );
}

/**
 * Everything at once, for the global "+ → Zadatak" sheet: that sheet IS the
 * form, so its fields belong in it rather than behind four more taps. The
 * composer uses the same bodies one at a time instead.
 *
 * Recurrence is the one exception, and it earned it: period, interval, weekdays,
 * an end date and the completion switch add up to more than the rest of the form
 * put together, for a dimension most tasks never touch. It sits behind one row
 * that reads back what is set, so the sheet stays a sheet.
 */
export function TaskAllFields({ draft, setDraft, listScope = null }: TaskWhoSheetBodyProps) {
  return (
    <div className="flex flex-col gap-4">
      <TaskDateSheetBody draft={draft} setDraft={setDraft} />
      <TaskWhoSheetBody draft={draft} setDraft={setDraft} listScope={listScope} />
      {draft.dueDate ? <TaskRecurrenceField draft={draft} setDraft={setDraft} /> : null}
      {draft.dueDate ? <TaskReminderSheetBody draft={draft} setDraft={setDraft} /> : null}
    </div>
  );
}

/**
 * The recurrence block as ONE field row plus an overlay - the `DateField` shape,
 * for the same reason: a control nobody uses on most tasks should cost one line
 * until it is asked for.
 */
function TaskRecurrenceField({ draft, setDraft }: TaskFieldsProps) {
  const [open, setOpen] = useState(false);

  return (
    <PickerOverlay
      open={open}
      onOpenChange={setOpen}
      title="Ponavljanje"
      description="Koliko često se zadatak vraća, i do kada."
      trigger={({ onOpen }) => (
        <PickerRow
          title="Ponavljanje"
          icon={<ArrowPathIcon className="size-[17px]" aria-hidden="true" />}
          summary={taskRecurrenceSummary(draft) ?? "Bez ponavljanja"}
          onClick={onOpen}
        />
      )}
    >
      <TaskRecurrenceSheetBody draft={draft} setDraft={setDraft} />
    </PickerOverlay>
  );
}
