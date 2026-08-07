import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Chip,
  ChipRow,
  FieldGroupLabel,
  FormInput,
  FormSelect,
} from "@/components/common/FormControls";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import type { Profile, SchoolBreak } from "@/types/database";
import {
  useCreateSchoolBreak,
  useDeleteSchoolBreak,
  useUpdateSchoolBreak,
} from "@/hooks/useSchoolBreaks";
import { monthNameOfNumber } from "@/utils/budget";

/**
 * Add / edit one raspust.
 *
 * There is no year field, by design: a raspust repeats every year (see the
 * `school_breaks` migration). That is also why the day list allows 29 February
 * unconditionally - the value is only ever compared as `month * 100 + day`,
 * never turned into a real date.
 */

/** Longest possible month, so 29.02 stays selectable. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Starting points for the two breaks every family has. Dates shift a little
 * from year to year, so these are a first draft to correct, not a claim - but
 * they turn the summer break, the whole reason this feature exists, into one
 * tap plus a glance.
 */
const PRESETS = [
  { name: "Letnji raspust", startMonth: 6, startDay: 21, endMonth: 8, endDay: 31 },
  { name: "Zimski raspust", startMonth: 12, startDay: 30, endMonth: 1, endDay: 20 },
  { name: "Prolećni raspust", startMonth: 4, startDay: 1, endMonth: 4, endDay: 10 },
] as const;

export type SchoolBreakFormProps = {
  /** The break being edited; null adds a new one. */
  schoolBreak: SchoolBreak | null;
  /** Person ids the break already applies to (empty = every child). */
  initialPersonIds: ReadonlyArray<string>;
  /** Children with a timetable - the only ones a raspust can name. */
  students: ReadonlyArray<Profile>;
  onDone: () => void;
};

export function SchoolBreakForm({
  schoolBreak,
  initialPersonIds,
  students,
  onDone,
}: SchoolBreakFormProps) {
  const create = useCreateSchoolBreak();
  const update = useUpdateSchoolBreak();
  const remove = useDeleteSchoolBreak();

  const [name, setName] = useState(schoolBreak?.name ?? "");
  const [startMonth, setStartMonth] = useState(schoolBreak?.start_month ?? 6);
  const [startDay, setStartDay] = useState(schoolBreak?.start_day ?? 21);
  const [endMonth, setEndMonth] = useState(schoolBreak?.end_month ?? 8);
  const [endDay, setEndDay] = useState(schoolBreak?.end_day ?? 31);
  const [personIds, setPersonIds] = useState<string[]>([...initialPersonIds]);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const isPending = create.isPending || update.isPending || remove.isPending;
  const trimmedName = name.trim();

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setName(preset.name);
    setStartMonth(preset.startMonth);
    setStartDay(preset.startDay);
    setEndMonth(preset.endMonth);
    setEndDay(preset.endDay);
  };

  const handleSave = async () => {
    if (!trimmedName) return;
    const payload = {
      name: trimmedName,
      start_month: startMonth,
      start_day: startDay,
      end_month: endMonth,
      end_day: endDay,
      personIds,
    };
    try {
      if (schoolBreak) {
        await update.mutateAsync({ id: schoolBreak.id, ...payload });
        toast.success("Raspust sačuvan");
      } else {
        await create.mutateAsync(payload);
        toast.success("Raspust dodat");
      }
      onDone();
    } catch {
      // Error toast handled by the mutation hook.
    }
  };

  const handleRemove = async () => {
    if (!schoolBreak) return;
    try {
      await remove.mutateAsync(schoolBreak.id);
      toast.success("Raspust obrisan");
      onDone();
    } catch {
      // Error toast handled by the mutation hook.
    }
  };

  // End before start is not an error - it is how the winter break is written.
  const wrapsNewYear = endMonth * 100 + endDay < startMonth * 100 + startDay;

  return (
    <div className="space-y-3">
      {!schoolBreak ? (
        <div>
          <FieldGroupLabel>Brzi izbor</FieldGroupLabel>
          <ChipRow role="group" aria-label="Brzi izbor raspusta">
            {PRESETS.map((preset) => (
              <Chip key={preset.name} onClick={() => applyPreset(preset)}>
                {preset.name.replace(" raspust", "")}
              </Chip>
            ))}
          </ChipRow>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="school-break-name">Naziv</Label>
        <FormInput
          id="school-break-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="npr. Letnji raspust"
          required
        />
      </div>

      <MonthDayField
        label="Od"
        idPrefix="school-break-start"
        month={startMonth}
        day={startDay}
        onChange={(m, d) => {
          setStartMonth(m);
          setStartDay(d);
        }}
      />
      <MonthDayField
        label="Do"
        idPrefix="school-break-end"
        month={endMonth}
        day={endDay}
        onChange={(m, d) => {
          setEndMonth(m);
          setEndDay(d);
        }}
      />

      <p className="text-xs text-muted-foreground">
        {wrapsNewYear
          ? "Raspust ide preko Nove godine i važi svake godine - godina se ne unosi."
          : "Raspust važi svake godine, zato se godina i ne unosi."}
      </p>

      <MemberMultiSelect
        label="Deca"
        value={personIds}
        onChange={setPersonIds}
        people={students}
        hint={
          personIds.length === 0
            ? "Prazno znači sva deca sa rasporedom."
            : "Raspust važi samo za izabranu decu."
        }
        emptyLabel="Nijedno dete još nema raspored časova."
      />

      {confirmingRemove ? (
        <div className="space-y-2 rounded-md border border-neg/40 bg-neg-soft p-2.5">
          <p className="text-xs text-neg">
            Obrisati raspust? Raspored časova se od tada opet prikazuje u tim danima.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingRemove(false)}
              disabled={isPending}
            >
              Odustani
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void handleRemove()}
              disabled={isPending}
            >
              Obriši raspust
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          {schoolBreak ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-neg hover:brightness-90"
              onClick={() => setConfirmingRemove(true)}
            >
              <TrashIcon className="mr-1 h-4 w-4" />
              Obriši
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={isPending || !trimmedName}
          >
            Sačuvaj
          </Button>
        </div>
      )}
    </div>
  );
}

/** Day + month, side by side. No year - see the component doc above. */
function MonthDayField({
  label,
  idPrefix,
  month,
  day,
  onChange,
}: {
  label: string;
  idPrefix: string;
  month: number;
  day: number;
  onChange: (month: number, day: number) => void;
}) {
  const maxDay = DAYS_IN_MONTH[month - 1];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-day`}>{label}</Label>
      <div className="flex gap-2">
        <FormSelect
          id={`${idPrefix}-day`}
          aria-label={`${label} - dan`}
          className="w-24 shrink-0"
          value={day}
          onChange={(e) => onChange(month, Number(e.target.value))}
        >
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}.
            </option>
          ))}
        </FormSelect>
        <FormSelect
          aria-label={`${label} - mesec`}
          className="flex-1"
          value={month}
          onChange={(e) => {
            const nextMonth = Number(e.target.value);
            // Shorter month: clamp instead of silently keeping an out-of-range
            // day (31. mart → 31. april would fail the CHECK on save).
            onChange(nextMonth, Math.min(day, DAYS_IN_MONTH[nextMonth - 1]));
          }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {monthNameOfNumber(m)}
            </option>
          ))}
        </FormSelect>
      </div>
    </div>
  );
}
