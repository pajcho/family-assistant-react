import { Fragment, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import type { BellSchedule, SchoolShift } from "@/types/database";
import { normalizeTime } from "@/utils/activity";
import { computeBellGrid } from "@/utils/schoolTimetable";
import { useUpsertBellSchedule, type BellScheduleInput } from "@/hooks/useBellSchedule";

export type BellSchedulePanelProps = {
  /** The effective bell schedule (stored row or synthesized defaults). */
  bell: BellSchedule;
  /** Called after a successful save or a cancel. */
  onClose?: () => void;
};

type FormState = BellScheduleInput;

function fromBell(bell: BellSchedule): FormState {
  return {
    period_minutes: bell.period_minutes,
    small_break_minutes: bell.small_break_minutes,
    big_break_minutes: bell.big_break_minutes,
    max_periods: bell.max_periods,
    morning_start: normalizeTime(bell.morning_start),
    morning_big_break_after: bell.morning_big_break_after,
    afternoon_start: normalizeTime(bell.afternoon_start),
    afternoon_big_break_after: bell.afternoon_big_break_after,
    afternoon_predcas_start: normalizeTime(bell.afternoon_predcas_start),
    afternoon_predcas_big_break_after: bell.afternoon_predcas_big_break_after,
  };
}

/**
 * Bell-schedule editor body — numbers + three band start times + a live grid
 * preview. Headerless so it renders inside a dialog or the options sheet.
 */
export function BellSchedulePanel({ bell, onClose }: BellSchedulePanelProps) {
  const upsert = useUpsertBellSchedule();
  const [form, setForm] = useState<FormState>(() => fromBell(bell));

  // Re-sync when the underlying row changes (e.g. realtime), but only the
  // initial mount really matters here.
  useEffect(() => {
    setForm(fromBell(bell));
  }, [bell]);

  const setNum = (key: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    setForm((f) => ({ ...f, [key]: Number.isFinite(n) ? n : 0 }));
  };
  const setTime = (key: keyof FormState) => (v: string | null) => {
    if (!v) return; // start times are required — ignore a clear.
    setForm((f) => ({ ...f, [key]: v }));
  };

  const draftBell: BellSchedule = { ...bell, ...form };

  const handleSave = async () => {
    try {
      await upsert.mutateAsync(form);
      onClose?.();
    } catch {
      // Error toast handled by the mutation hook.
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Trajanja i početak smena. Vremena svih časova u rasporedu se računaju odavde.
      </p>

      {/* Durations */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField
          label="Čas (min)"
          value={form.period_minutes}
          onChange={setNum("period_minutes")}
        />
        <NumberField
          label="Mali odmor"
          value={form.small_break_minutes}
          onChange={setNum("small_break_minutes")}
        />
        <NumberField
          label="Veliki odmor"
          value={form.big_break_minutes}
          onChange={setNum("big_break_minutes")}
        />
        <NumberField
          label="Maks. časova"
          value={form.max_periods}
          onChange={setNum("max_periods")}
          min={1}
          max={12}
        />
      </div>

      {/* Bands */}
      <BandRow
        title="Jutarnja smena"
        start={form.morning_start}
        onStart={setTime("morning_start")}
        bigBreakAfter={form.morning_big_break_after}
        onBigBreakAfter={setNum("morning_big_break_after")}
      />
      <BandRow
        title="Popodnevna smena"
        start={form.afternoon_start}
        onStart={setTime("afternoon_start")}
        bigBreakAfter={form.afternoon_big_break_after}
        onBigBreakAfter={setNum("afternoon_big_break_after")}
      />
      <BandRow
        title="Popodne sa pred-časom"
        start={form.afternoon_predcas_start}
        onStart={setTime("afternoon_predcas_start")}
        bigBreakAfter={form.afternoon_predcas_big_break_after}
        onBigBreakAfter={setNum("afternoon_predcas_big_break_after")}
      />

      {/* Live preview */}
      <div className="grid gap-3 sm:grid-cols-3">
        <BandPreview title="Jutro" bell={draftBell} band="morning" usesPredcas={false} />
        <BandPreview title="Popodne" bell={draftBell} band="afternoon" usesPredcas={false} />
        <BandPreview title="Pred-čas" bell={draftBell} band="afternoon" usesPredcas={true} />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={() => onClose?.()}>
          Otkaži
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={upsert.isPending}>
          Sačuvaj
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 180,
}: {
  label: string;
  value: number;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

function BandRow({
  title,
  start,
  onStart,
  bigBreakAfter,
  onBigBreakAfter,
}: {
  title: string;
  start: string;
  onStart: (v: string | null) => void;
  bigBreakAfter: number;
  onBigBreakAfter: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">{title} — početak</Label>
        <TimePicker value={start} onChange={onStart} clearable={false} />
      </div>
      <div className="w-28 space-y-1">
        <Label className="text-xs">Veliki odmor posle</Label>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={12}
          value={bigBreakAfter}
          onChange={onBigBreakAfter}
        />
      </div>
    </div>
  );
}

function BandPreview({
  title,
  bell,
  band,
  usesPredcas,
}: {
  title: string;
  bell: BellSchedule;
  band: SchoolShift;
  usesPredcas: boolean;
}) {
  const grid = useMemo(() => computeBellGrid(bell, band, usesPredcas), [bell, band, usesPredcas]);
  return (
    <div className="rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
      <div className="mb-1 font-semibold text-gray-700 dark:text-gray-200">{title}</div>
      <ol className="space-y-0.5">
        {grid.map((slot) => (
          <Fragment key={slot.periodIndex}>
            <li className="flex justify-between tabular-nums text-muted-foreground">
              <span>{slot.periodIndex}.</span>
              <span>
                {slot.startTime}–{slot.endTime}
              </span>
            </li>
            {slot.bigBreakAfter ? (
              <li className="text-center text-[9px] uppercase text-amber-600 dark:text-amber-400">
                odmor
              </li>
            ) : null}
          </Fragment>
        ))}
      </ol>
    </div>
  );
}
