import type { Dispatch, SetStateAction } from "react";
import { CheckIcon, ClockIcon } from "@heroicons/react/24/outline";

import { DateField } from "@/components/common/DateField";
import { Chip, ChipRow, FieldGroupLabel, FieldHint } from "@/components/common/FormControls";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import { TimeField } from "@/components/common/TimeField";
import { NativeSelect } from "@/components/ui/native-select";
import { ReminderSelect } from "@/components/ui/reminder-select";
import {
  DAILY_INTERVAL_OPTIONS,
  MONTHLY_INTERVAL_OPTIONS,
  TASK_DAY_REMINDER_OPTIONS,
  TASK_RECURRENCE_OPTIONS,
  TASK_TIME_REMINDER_OPTIONS,
  WEEKLY_INTERVAL_OPTIONS,
  type TaskDraft,
} from "@/components/tasks/taskDraft";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { cn } from "@/lib/cn";
import { DAY_LABELS_SHORT } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";

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

/** "Ana" / "Ana, Marko" / "3 osobe" - the who chip's read-back. */
export function useTaskAssigneeSummary(draft: TaskDraft): string | null {
  const { byId } = useFamilyMembers();
  if (draft.assigneeIds.length === 0) return null;
  if (draft.assigneeIds.length > 2) return `${draft.assigneeIds.length} osobe`;
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

/** "Za koga": the assignee pills. Nobody selected means family-wide. */
export function TaskWhoSheetBody({ draft, setDraft }: TaskFieldsProps) {
  return (
    <MemberMultiSelect
      label="Za koga"
      hint="Prazno = zadatak je porodičan, ničiji posebno. Dete vidi samo ono što mu je dodeljeno."
      value={draft.assigneeIds}
      onChange={(assigneeIds) => setDraft((s) => ({ ...s, assigneeIds }))}
    />
  );
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
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        {TASK_RECURRENCE_OPTIONS.map((option) => {
          const selected = period === option.value;
          return (
            <button
              type="button"
              key={option.value}
              aria-pressed={selected}
              onClick={() =>
                setDraft((s) => ({
                  ...s,
                  recurrencePeriod: option.value,
                  // Always back to 1: the weekly and monthly scales do not share
                  // a meaning, and for one-time it is ignored on submit.
                  recurrenceInterval: 1,
                  recurrenceWeekdays: option.value === "weekly" ? s.recurrenceWeekdays : [],
                  recurrenceUntil: option.value === "one-time" ? null : s.recurrenceUntil,
                }))
              }
              className={cn(
                "flex min-h-11 w-full items-center justify-between rounded-lg border bg-card px-3.5 py-2.5 text-sm font-normal transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
                selected
                  ? "border-accent bg-accent-soft text-accent-deep"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {option.label}
              {selected ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      {period !== "one-time" ? (
        <div>
          <FieldGroupLabel>
            <label htmlFor="task-recurrence-interval">Na koliko</label>
          </FieldGroupLabel>
          <NativeSelect
            id="task-recurrence-interval"
            value={draft.recurrenceInterval}
            onChange={(recurrenceInterval) => setDraft((s) => ({ ...s, recurrenceInterval }))}
            options={intervalOptions}
            parse={(raw) => Number(raw)}
          />
        </div>
      ) : null}

      {period === "weekly" ? (
        <div>
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
 */
export function TaskAllFields({ draft, setDraft }: TaskFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <TaskDateSheetBody draft={draft} setDraft={setDraft} />
      <TaskWhoSheetBody draft={draft} setDraft={setDraft} />
      {draft.dueDate ? <TaskRecurrenceSheetBody draft={draft} setDraft={setDraft} /> : null}
      {draft.dueDate ? <TaskReminderSheetBody draft={draft} setDraft={setDraft} /> : null}
    </div>
  );
}
