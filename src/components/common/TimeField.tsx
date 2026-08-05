import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ClockIcon } from "@heroicons/react/24/outline";

import { Chip, FieldGroupLabel, FieldHint, FormInput } from "@/components/common/FormControls";
import { PickerOverlay } from "@/components/common/PickerOverlay";
import { PickerRow } from "@/components/common/PickerRow";
import { cn } from "@/lib/cn";
import {
  DURATION_PRESETS,
  MINUTE_STEPS,
  PRIMARY_HOURS,
  SECONDARY_HOURS,
  addMinutesToTime,
  durationBetween,
  formatDuration,
  minutesToTime,
  timeToMinutes,
} from "@/utils/pickerGrid";

/**
 * TimeField - time in two taps.
 *
 * The picker is an hour grid (7-22 up front, the rest one tap away behind
 * "Ostali sati") followed by four minute chips (:00 :15 :30 :45); picking the
 * minutes closes the sheet. Anything unusual (11:37) is still reachable: a
 * LONG PRESS on the field opens the native `<input type="time">`, and the
 * picker itself carries a "Tačno vreme" box.
 */

const LONG_PRESS_MS = 450;

export type TimeFieldProps = {
  id?: string;
  label: ReactNode;
  /** `HH:mm` or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Offer a "Bez vremena" row inside the picker. */
  clearable?: boolean;
  /** Default hour highlighted when nothing is set yet. */
  defaultTime?: string;
  icon?: ReactNode;
  className?: string;
};

export function TimeField({
  id,
  label,
  value,
  onChange,
  placeholder = "--:--",
  disabled = false,
  clearable = false,
  defaultTime = "17:00",
  icon,
  className,
}: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  const [showAllHours, setShowAllHours] = useState(false);
  const [exact, setExact] = useState("");

  const nativeRef = useRef<HTMLInputElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const currentMinutes = timeToMinutes(value ?? defaultTime);
  const seedHour = currentMinutes != null ? Math.floor(currentMinutes / 60) : null;

  useEffect(() => {
    if (!open) return;
    setHour(seedHour);
    setShowAllHours(seedHour != null && !PRIMARY_HOURS.includes(seedHour));
    setExact(value ?? "");
  }, [open, seedHour, value]);

  useEffect(
    () => () => {
      if (longPressTimer.current != null) window.clearTimeout(longPressTimer.current);
    },
    [],
  );

  const hours = useMemo(
    () => (showAllHours ? [...PRIMARY_HOURS, ...SECONDARY_HOURS] : [...PRIMARY_HOURS]),
    [showAllHours],
  );

  const preview =
    hour != null
      ? minutesToTime(hour * 60 + (currentMinutes != null ? currentMinutes % 60 : 0))
      : (value ?? "--:--");

  const pickMinutes = (minutes: string) => {
    if (hour == null) return;
    onChange(minutesToTime(hour * 60 + Number(minutes)));
    setOpen(false);
  };

  // Long press = native picker. Pointer events cover mouse and touch; the
  // timer is cleared on move/up so a normal tap still opens our sheet.
  const startLongPress = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || e.pointerType === "mouse") return;
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      const input = nativeRef.current;
      if (!input) return;
      input.focus();
      try {
        // Chromium/Firefox open the wheel directly; Safari has no showPicker
        // and relies on the focus above (plus the "Tačno vreme" box as a
        // guaranteed fallback inside the panel).
        input.showPicker?.();
      } catch {
        /* not user-activated - the panel's exact-time box still covers it */
      }
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const renderTrigger = ({ onOpen }: { onOpen?: () => void }) => (
    <PickerRow
      id={id}
      title={label}
      icon={icon ?? <ClockIcon className="size-[17px]" aria-hidden="true" />}
      summary={
        value ? (
          <span className="tabular-nums">{value}</span>
        ) : (
          <span className="font-normal">{placeholder}</span>
        )
      }
      disabled={disabled}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerMove={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClick={
        onOpen
          ? () => {
              // The long press already opened the native picker - swallow the
              // click it leaves behind so the sheet doesn't stack on top.
              if (longPressFired.current) {
                longPressFired.current = false;
                return;
              }
              onOpen();
            }
          : undefined
      }
      className={className}
    />
  );

  return (
    <>
      {/* Native fallback for odd times - kept off-screen, opened by long press. */}
      <input
        ref={nativeRef}
        type="time"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute size-0 opacity-0"
      />
      <PickerOverlay
        open={open}
        onOpenChange={setOpen}
        title="Vreme"
        description="Sat pa minuti - dva tapa. Za neuobičajeno vreme koristi polje na dnu."
        trigger={renderTrigger}
      >
        <div className="flex flex-col gap-2">
          <div className="rounded-xl border border-border bg-card p-2.5 text-center shadow-card">
            <div className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
              Izabrano
            </div>
            <div className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums">{preview}</div>
          </div>

          <FieldGroupLabel>Sat</FieldGroupLabel>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Sat">
            {hours.map((h) => (
              <Chip
                key={h}
                grow
                selected={hour === h}
                aria-label={`${h} sati`}
                onClick={() => setHour(h)}
              >
                <span className="tabular-nums">{h}</span>
              </Chip>
            ))}
            {!showAllHours ? (
              <Chip grow onClick={() => setShowAllHours(true)} className="col-span-2">
                Ostali sati
              </Chip>
            ) : null}
          </div>

          <FieldGroupLabel>Minuti</FieldGroupLabel>
          <div className="flex gap-1.5" role="group" aria-label="Minuti">
            {MINUTE_STEPS.map((m) => (
              <Chip
                key={m}
                grow
                disabled={hour == null}
                selected={value != null && value.endsWith(`:${m}`)}
                aria-label={`${m} minuta`}
                onClick={() => pickMinutes(m)}
              >
                <span className="tabular-nums">:{m}</span>
              </Chip>
            ))}
          </div>
          {hour == null ? <FieldHint>Prvo izaberi sat.</FieldHint> : null}

          <FieldGroupLabel>Tačno vreme</FieldGroupLabel>
          <div className="flex gap-2">
            <FormInput
              value={exact}
              onChange={(e) => setExact(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (timeToMinutes(exact) != null) {
                  onChange(exact);
                  setOpen(false);
                }
              }}
              inputMode="numeric"
              placeholder="npr. 11:37"
              aria-label="Tačno vreme"
              className="flex-1"
            />
            <Chip
              disabled={timeToMinutes(exact) == null}
              onClick={() => {
                onChange(exact);
                setOpen(false);
              }}
            >
              Potvrdi
            </Chip>
          </div>

          {clearable && value ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="min-h-11 rounded-lg border border-border bg-card text-sm font-normal text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Bez vremena
            </button>
          ) : null}
        </div>
      </PickerOverlay>
    </>
  );
}

export type DurationChipsProps = {
  /** Start time the presets are measured from; chips disable without it. */
  start: string | null;
  end: string | null;
  onChangeEnd: (end: string) => void;
  /** Minute presets; defaults to 30 / 45 / 60 / 90 / 120. */
  presets?: ReadonlyArray<number>;
  className?: string;
};

/**
 * Trajanje chips under a start/end pair: each one writes the END time
 * (`start + N`), so a 90-minute meeting is one tap instead of a second time
 * picker. The chip matching the current span reads as selected.
 */
export function DurationChips({
  start,
  end,
  onChangeEnd,
  presets = DURATION_PRESETS,
  className,
}: DurationChipsProps) {
  const active = start && end ? durationBetween(start, end) : null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label="Trajanje">
      {presets.map((minutes) => (
        <Chip
          key={minutes}
          selected={active === minutes}
          disabled={!start}
          aria-label={`Trajanje ${formatDuration(minutes)}`}
          onClick={() => {
            if (!start) return;
            const next = addMinutesToTime(start, minutes);
            if (next) onChangeEnd(next);
          }}
        >
          {formatDuration(minutes)}
        </Chip>
      ))}
    </div>
  );
}
