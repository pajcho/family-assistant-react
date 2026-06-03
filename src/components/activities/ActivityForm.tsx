import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENT_REMINDER_OPTIONS, ReminderSelect } from "@/components/ui/reminder-select";
import { TimePicker } from "@/components/ui/time-picker";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import { cn } from "@/lib/cn";
import type { Activity, ActivitySchedule, Profile, WeekPattern } from "@/types/database";
import { DAY_LABELS_FULL } from "@/utils/activity";

/**
 * Form payload — the parent page splits this into:
 *   • create/update activity (everything except `rules` and `person_ids`)
 *   • replace schedule rules in one batch (`rules`)
 *   • replace participants in one batch (`person_ids`)
 *
 * All calls are awaited in sequence; failures bubble back as toasts via
 * the mutation hooks.
 */
export type ActivityFormPayload = {
  person_ids: string[];
  name: string;
  description: string | null;
  active_from: string | null;
  active_to: string | null;
  is_paused: boolean;
  remind_minutes_before: number | null;
  notes: string | null;
  rules: ScheduleRuleDraft[];
};

export type ScheduleRuleDraft = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  week_pattern: WeekPattern;
  recurrence_interval_weeks: number;
};

export type ActivityFormProps = {
  activity?: Activity | null;
  /** Existing schedule rules for `activity` — empty list when adding new. */
  existingRules?: ReadonlyArray<ActivitySchedule>;
  /** Current participants — empty when adding a new activity. */
  existingPersonIds?: ReadonlyArray<string>;
  /** Family members — used to preselect a default participant when adding. */
  people: ReadonlyArray<Profile>;
  /** Person ids that have an alternating school-shift anchor. A/B opens up when at least one selected participant qualifies. */
  peopleWithShift: ReadonlySet<string>;
  /** Default person to preselect when creating (e.g. current user's id). */
  defaultPersonId?: string | null;
  saving?: boolean;
  onSubmit: (payload: ActivityFormPayload) => void;
  onCancel: () => void;
};

const DAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = DAY_LABELS_FULL.map(
  (label, index) => ({ value: index, label }),
);

/**
 * Pattern dropdown collapses two underlying fields (`week_pattern` +
 * `recurrence_interval_weeks`) into a single select. Composite values like
 * `every:2` are split on submit. Keeps the rule card to three rows.
 */
type PatternOption = {
  value: string;
  label: string;
  pattern: WeekPattern;
  interval: number;
  /** When true, only render this option for people with an alternating shift. */
  requiresAlternatingShift?: boolean;
};

const PATTERN_OPTIONS: ReadonlyArray<PatternOption> = [
  { value: "every:1", label: "Svake nedelje", pattern: "every", interval: 1 },
  { value: "every:2", label: "Svake 2 nedelje", pattern: "every", interval: 2 },
  { value: "every:3", label: "Svake 3 nedelje", pattern: "every", interval: 3 },
  { value: "every:4", label: "Svake 4 nedelje", pattern: "every", interval: 4 },
  {
    value: "A",
    label: "A (jutarnja)",
    pattern: "A",
    interval: 1,
    requiresAlternatingShift: true,
  },
  {
    value: "B",
    label: "B (popodnevna)",
    pattern: "B",
    interval: 1,
    requiresAlternatingShift: true,
  },
];

function patternValueFromRule(rule: ScheduleRuleDraft): string {
  if (rule.week_pattern !== "every") return rule.week_pattern;
  return `every:${Math.max(1, Math.floor(rule.recurrence_interval_weeks))}`;
}

function ruleUpdateFromPattern(
  value: string,
): Pick<ScheduleRuleDraft, "week_pattern" | "recurrence_interval_weeks"> {
  const option = PATTERN_OPTIONS.find((o) => o.value === value);
  if (!option) return { week_pattern: "every", recurrence_interval_weeks: 1 };
  return { week_pattern: option.pattern, recurrence_interval_weeks: option.interval };
}

const SELECT_CHROME =
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-9 pl-3 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

function NativeSelect<T extends string | number>({
  id,
  value,
  onChange,
  options,
  disabled,
  parse,
}: {
  id?: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
  parse: (raw: string) => T;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={String(value)}
        onChange={(e) => onChange(parse(e.target.value))}
        disabled={disabled}
        className={SELECT_CHROME}
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

function emptyRule(): ScheduleRuleDraft {
  return {
    day_of_week: 0,
    start_time: "16:00",
    end_time: "17:00",
    week_pattern: "every",
    recurrence_interval_weeks: 1,
  };
}

type FormState = {
  person_ids: string[];
  name: string;
  description: string;
  active_from: string | null;
  active_to: string | null;
  is_paused: boolean;
  remind_minutes_before: number | null;
  notes: string;
  rules: ScheduleRuleDraft[];
};

function initialState(
  activity: Activity | null | undefined,
  existingRules: ReadonlyArray<ActivitySchedule> | undefined,
  existingPersonIds: ReadonlyArray<string> | undefined,
  fallbackPersonId: string,
): FormState {
  const rules =
    existingRules && existingRules.length > 0
      ? existingRules.map((r) => ({
          day_of_week: r.day_of_week,
          // Postgres TIME comes back as "HH:MM:SS" — the time input wants "HH:MM".
          start_time: r.start_time.slice(0, 5),
          end_time: r.end_time.slice(0, 5),
          week_pattern: r.week_pattern,
          recurrence_interval_weeks: r.recurrence_interval_weeks ?? 1,
        }))
      : [emptyRule()];

  const person_ids =
    existingPersonIds && existingPersonIds.length > 0
      ? [...existingPersonIds]
      : fallbackPersonId
        ? [fallbackPersonId]
        : [];

  return {
    person_ids,
    name: activity?.name ?? "",
    description: activity?.description ?? "",
    active_from: activity?.active_from ?? null,
    active_to: activity?.active_to ?? null,
    is_paused: activity?.is_paused ?? false,
    remind_minutes_before: activity?.remind_minutes_before ?? null,
    notes: activity?.notes ?? "",
    rules,
  };
}

export function ActivityForm({
  activity,
  existingRules,
  existingPersonIds,
  people,
  peopleWithShift,
  defaultPersonId,
  saving = false,
  onSubmit,
  onCancel,
}: ActivityFormProps) {
  const fallbackPersonId = defaultPersonId ?? people[0]?.id ?? "";
  const [form, setForm] = useState<FormState>(() =>
    initialState(activity, existingRules, existingPersonIds, fallbackPersonId),
  );

  // Reset whenever the dialog opens with a different activity. The
  // `existingRules` / `existingPersonIds` identities also flip for the
  // same id once they load.
  useEffect(() => {
    setForm(initialState(activity, existingRules, existingPersonIds, fallbackPersonId));
  }, [activity, existingRules, existingPersonIds, fallbackPersonId]);

  const isEdit = !!activity?.id;
  // A/B opens up when at least one selected participant has an alternating
  // shift. For everyone else the resolver silently skips the A/B rule for
  // their block, which is the right semantic for mixed-shift activities.
  const personHasShift = form.person_ids.some((id) => peopleWithShift.has(id));
  const [showSeason, setShowSeason] = useState<boolean>(
    !!(activity?.active_from || activity?.active_to),
  );

  const handleRuleChange = (index: number, patch: Partial<ScheduleRuleDraft>) => {
    setForm((s) => {
      const next = s.rules.slice();
      next[index] = { ...next[index], ...patch };
      return { ...s, rules: next };
    });
  };

  const handleAddRule = () => {
    setForm((s) => ({ ...s, rules: [...s.rules, emptyRule()] }));
  };

  const handleRemoveRule = (index: number) => {
    setForm((s) => ({ ...s, rules: s.rules.filter((_, i) => i !== index) }));
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = form.name.trim();
    if (!trimmedName || form.person_ids.length === 0) return;

    // Drop rules with invalid times (end <= start) silently — the row UI
    // already nudges with the inputs going red; submitting just skips them.
    const validRules = form.rules
      .filter((r) => r.start_time && r.end_time && r.end_time > r.start_time)
      // When no selected participant has a shift, A/B rules don't make
      // sense — coerce to 'every' so the row still survives.
      .map((r) =>
        !personHasShift && r.week_pattern !== "every"
          ? { ...r, week_pattern: "every" as const, recurrence_interval_weeks: 1 }
          : r,
      );

    onSubmit({
      person_ids: form.person_ids,
      name: trimmedName,
      description: form.description.trim() || null,
      active_from: form.active_from,
      active_to: form.active_to,
      is_paused: form.is_paused,
      remind_minutes_before: form.remind_minutes_before,
      notes: form.notes.trim() || null,
      rules: validRules,
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="name">Naziv aktivnosti *</Label>
        <Input
          id="name"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          required
          placeholder="npr. Trening fudbala"
        />
      </div>
      <div className="space-y-1">
        <MemberMultiSelect
          label="Učesnici *"
          value={form.person_ids}
          onChange={(person_ids) => setForm((s) => ({ ...s, person_ids }))}
        />
        {form.person_ids.length === 0 ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Izaberi bar jednog učesnika.
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Opis</Label>
        <Input
          id="description"
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          placeholder="dodatni detalji (opciono)"
        />
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <Label className="mb-0">Termini *</Label>
          <Button type="button" variant="outline" size="sm" onClick={handleAddRule}>
            <PlusIcon className="mr-1 h-4 w-4" />
            Dodaj termin
          </Button>
        </div>
        {!personHasShift ? (
          <p className="text-xs text-muted-foreground">
            Postavi školsku smenu za ovu osobu da bi mogao da koristiš A/B nedelje.
          </p>
        ) : null}
        <div className="space-y-2">
          {form.rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Dodaj bar jedan termin.</p>
          ) : null}
          {form.rules.map((rule, index) => {
            const invalid =
              !!rule.start_time && !!rule.end_time && rule.end_time <= rule.start_time;
            return (
              <div
                key={index}
                className={cn(
                  // Card-style stacked layout — works in the narrow drawer on
                  // mobile and stays readable on desktop. Day select on top
                  // gets the full row width so the longest names (Ponedeljak,
                  // Četvrtak) never truncate.
                  "space-y-2 rounded-md border p-2",
                  invalid
                    ? "border-red-300 bg-red-50/40 dark:border-red-700 dark:bg-red-900/10"
                    : "border-gray-200 dark:border-gray-700",
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <NativeSelect
                      value={rule.day_of_week}
                      onChange={(next) => handleRuleChange(index, { day_of_week: next })}
                      options={DAY_OPTIONS}
                      parse={(raw) => Number(raw)}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Ukloni termin"
                    onClick={() => handleRemoveRule(index)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <TimePicker
                      value={rule.start_time}
                      onChange={(value) => handleRuleChange(index, { start_time: value ?? "" })}
                      clearable={false}
                    />
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">–</span>
                  <div className="min-w-0 flex-1">
                    <TimePicker
                      value={rule.end_time}
                      onChange={(value) => handleRuleChange(index, { end_time: value ?? "" })}
                      clearable={false}
                    />
                  </div>
                </div>
                {/* Pattern dropdown — composite values like `every:2` carry
                    both the week_pattern and the recurrence interval so the
                    rule card stays a single row of fields. A/B options are
                    filtered out for people without an alternating shift. */}
                <NativeSelect
                  value={patternValueFromRule(rule)}
                  onChange={(next) => handleRuleChange(index, ruleUpdateFromPattern(next))}
                  options={PATTERN_OPTIONS.filter(
                    (o) => !o.requiresAlternatingShift || personHasShift,
                  ).map((o) => ({ value: o.value, label: o.label }))}
                  parse={(raw) => raw}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowSeason((v) => !v)}
        >
          {showSeason ? "Sakrij sezonu" : "Postavi sezonu (od / do)"}
        </button>
        {showSeason ? (
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="active_from">Od</Label>
              <DatePicker
                id="active_from"
                value={form.active_from}
                onChange={(value) => setForm((s) => ({ ...s, active_from: value }))}
                placeholder="npr. 1. septembar"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="active_to">Do</Label>
              <DatePicker
                id="active_to"
                value={form.active_to}
                onChange={(value) => setForm((s) => ({ ...s, active_to: value }))}
                placeholder="npr. 15. jun"
              />
            </div>
          </div>
        ) : null}
      </div>

      {isEdit ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_paused}
            onChange={(e) => setForm((s) => ({ ...s, is_paused: e.target.checked }))}
            className="rounded border-gray-300"
          />
          <span className="text-sm text-gray-700 dark:text-gray-200">Pauziraj aktivnost</span>
        </label>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="activity-reminder">Podsetnik</Label>
        <ReminderSelect
          id="activity-reminder"
          value={form.remind_minutes_before}
          onChange={(value) => setForm((s) => ({ ...s, remind_minutes_before: value }))}
          options={EVENT_REMINDER_OPTIONS}
        />
        <p className="text-[11px] text-muted-foreground">
          Svaki učesnik dobija push obaveštenje. Otkazani i pomereni termini se preskaču.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Beleške</Label>
        <Input
          id="notes"
          value={form.notes}
          onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
          placeholder="lokacija, trener, itd."
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Otkaži
        </Button>
        <Button type="submit" disabled={saving}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
