import { useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SyntheticEvent,
} from "react";
import { ClockIcon } from "@heroicons/react/24/outline";

import { Chip, FieldGroupLabel } from "@/components/common/FormControls";
import { PickerOverlay } from "@/components/common/PickerOverlay";
import { PickerRow } from "@/components/common/PickerRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  DURATION_PRESETS,
  HOURS,
  MINUTE_STEPS,
  addMinutesToTime,
  durationBetween,
  formatDuration,
  minutesToTime,
  timeToMinutes,
  typeTimeDigits,
} from "@/utils/pickerGrid";
import type { TimeDraft, TimeSegment } from "@/utils/pickerGrid";

/**
 * TimeField - time in two taps.
 *
 * The picker shows the whole day as a 6x4 hour grid followed by minute chips
 * in 5-minute steps; picking the minutes closes the sheet. Any exact time
 * (11:37) is typed straight into the big `HH:MM` header: each half is an
 * input dressed as plain digits, so tapping it and typing edits the number in
 * place. A LONG PRESS on the field still opens the native `<input type="time">`.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

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
  const [draft, setDraft] = useState<TimeDraft>({
    hour: null,
    minute: null,
    segment: "hour",
    pending: "",
  });
  const [focused, setFocused] = useState<TimeSegment | null>(null);

  const nativeRef = useRef<HTMLInputElement | null>(null);
  const minuteRef = useRef<HTMLInputElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // Reseed the picker whenever it opens (or the value changes while open).
  // Adjusted during render instead of in an effect to avoid a cascading render.
  const seedKey = open ? `open:${value ?? ""}` : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (open) {
      const seed = timeToMinutes(value ?? defaultTime);
      setDraft({
        hour: seed != null ? Math.floor(seed / 60) : null,
        minute: seed != null ? seed % 60 : null,
        segment: "hour",
        pending: "",
      });
      setFocused(null);
    }
  }

  useEffect(
    () => () => {
      if (longPressTimer.current != null) window.clearTimeout(longPressTimer.current);
    },
    [],
  );

  const commit = (hour: number | null, minute: number | null) => {
    if (hour == null || minute == null) return;
    onChange(minutesToTime(hour * 60 + minute));
    setOpen(false);
  };

  // What a header segment shows: the half-typed first digit while it waits
  // for a second one, otherwise the zero-padded value ("--" once cleared).
  const segmentText = (segment: TimeSegment) => {
    if (focused === segment && draft.pending) return draft.pending;
    const v = draft[segment];
    return v == null ? "--" : pad2(v);
  };

  const handleSegmentInput = (segment: TimeSegment) => (e: ChangeEvent<HTMLInputElement>) => {
    const native = e.nativeEvent as InputEvent;
    if (native.inputType?.startsWith("delete")) {
      setDraft((d) => ({ ...d, segment, [segment]: null, pending: "" }));
      return;
    }
    // `data` is the typed text; when a browser leaves it out (paste), diff the
    // new value against what the segment showed.
    const shown = segmentText(segment);
    const raw = e.target.value;
    const inserted = native.data ?? (raw.startsWith(shown) ? raw.slice(shown.length) : raw);
    const { draft: next, complete } = typeTimeDigits({ ...draft, segment }, inserted);
    if (complete) {
      commit(next.hour, next.minute);
      return;
    }
    setDraft(next);
    // Focus moves inside the input event, so the on-screen keyboard stays up.
    if (next.segment !== segment) minuteRef.current?.focus();
  };

  // Select the whole segment so the next keystroke replaces it instead of
  // landing next to a caret the member never sees.
  const selectSegment = (e: SyntheticEvent<HTMLInputElement>) => e.currentTarget.select();

  const renderSegment = (segment: TimeSegment) => (
    <input
      ref={segment === "minute" ? minuteRef : undefined}
      value={segmentText(segment)}
      onChange={handleSegmentInput(segment)}
      onFocus={(e) => {
        setFocused(segment);
        setDraft((d) => ({ ...d, segment, pending: "" }));
        selectSegment(e);
      }}
      onClick={selectSegment}
      onBlur={() => {
        setFocused(null);
        setDraft((d) => ({ ...d, pending: "" }));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        commit(draft.hour, draft.minute);
      }}
      inputMode="numeric"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={segment === "hour" ? "Sati" : "Minuti"}
      className={cn(
        // Plain digits until touched: no border, no caret, no selection tint.
        // Focus is shown the way a native segmented time input shows it - the
        // active half sits on an accent pill.
        "w-[2.3ch] cursor-text rounded-lg bg-transparent text-center tabular-nums caret-transparent transition-colors outline-none selection:bg-transparent",
        "hover:bg-muted focus:bg-accent-soft focus:text-accent-deep",
      )}
    />
  );

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
        // and relies on the focus above (plus the exact-time box as a
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
      // No chevron: these sit two-to-a-row, and the 16px arrow was eating the
      // last digit of the time on a phone. It pointed at nothing the row did
      // not already promise by being tappable.
      chevron={false}
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
        // text-base: it still takes focus when the long press opens it, and
        // iOS zooms the page onto any focused control under 16px.
        className="pointer-events-none absolute size-0 text-base opacity-0"
      />
      <PickerOverlay
        open={open}
        onOpenChange={setOpen}
        title="Vreme"
        description="Izaberi sat pa minute, ili dodirni vreme gore i ukucaj ga."
        trigger={renderTrigger}
      >
        <div className="flex flex-col gap-2">
          <div
            className="flex items-center justify-center rounded-xl border border-border bg-card py-2 text-4xl font-bold tracking-tight shadow-card"
            role="group"
            aria-label="Izabrano vreme"
          >
            {renderSegment("hour")}
            <span aria-hidden="true" className="px-0.5 pb-1 text-muted-foreground">
              :
            </span>
            {renderSegment("minute")}
          </div>

          <FieldGroupLabel>Sat</FieldGroupLabel>
          {/* The whole day, four rows of six: night, morning, afternoon,
              evening. No hidden "other hours" step - every hour is one tap. */}
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Sat">
            {HOURS.map((h) => (
              <Chip
                key={h}
                selected={draft.hour === h}
                aria-label={`${h} sati`}
                onClick={() => setDraft((d) => ({ ...d, hour: h, pending: "" }))}
                className="px-0 sm:min-h-9"
              >
                <span className="tabular-nums">{pad2(h)}</span>
              </Chip>
            ))}
          </div>

          <FieldGroupLabel>Minuti</FieldGroupLabel>
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Minuti">
            {MINUTE_STEPS.map((m) => (
              <Chip
                key={m}
                disabled={draft.hour == null}
                selected={draft.minute === m}
                aria-label={`${m} minuta`}
                onClick={() => commit(draft.hour, m)}
                className="px-0 sm:min-h-9"
              >
                <span className="tabular-nums">:{pad2(m)}</span>
              </Chip>
            ))}
          </div>

          {/* Changing only the hour (17:45 -> 18:45) or typing an exact time
              still needs a way out; the minute chips above close on their own. */}
          <Button
            type="button"
            size="lg"
            className="mt-2 min-h-11"
            disabled={draft.hour == null || draft.minute == null}
            onClick={() => commit(draft.hour, draft.minute)}
          >
            Potvrdi
          </Button>

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
