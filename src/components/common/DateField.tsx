import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

import {
  Chip,
  ChipRow,
  FieldGroupLabel,
  FieldHint,
  FormInput,
} from "@/components/common/FormControls";
import { PickerOverlay } from "@/components/common/PickerOverlay";
import { PickerRow } from "@/components/common/PickerRow";
import { useBusyDays, type BusyDays } from "@/hooks/useBusyDays";
import { useToday } from "@/hooks/useToday";
import { cn } from "@/lib/cn";
import {
  MONTH_NAMES_SR,
  MONTH_SHORT_SR,
  WEEKDAY_SHORT_SR,
  buildMonthGrid,
  clampIso,
  isoFromParts,
  parseTypedDate,
  partsFromIso,
  shiftIsoByDays,
  shiftMonth,
} from "@/utils/pickerGrid";

/**
 * DateField - the redesign's one date input.
 *
 * The field itself is a PickerRow; tapping it opens the picker (bottom sheet
 * on mobile, anchored popover on desktop). Inside, the shortcuts are chosen by
 * the field's MEANING, not by a generic calendar:
 *   - `future` (due dates, events): Danas · Sutra · Vikend · Za nedelju dana
 *   - `past` (expenses): Danas · Juče · Prekjuče
 *   - `dob` (birth dates): starts on the YEAR grid plus a "15.05.1985" text
 *     box - three taps to a date 40 years back instead of 480 arrow clicks.
 *
 * The month caption is a button that drills out to months and years (the
 * Material pattern), the grid carries occupancy dots from the family's agenda,
 * and a tap on a day both selects and closes.
 */

export type DateFieldMode = "future" | "past" | "dob";

export type DateFieldQuickChip = { label: string; iso: string; hint?: string };

export type DateFieldProps = {
  id?: string;
  /** Row label, e.g. "Datum dospeća *". */
  label: ReactNode;
  value: string | null;
  onChange: (value: string | null) => void;
  mode?: DateFieldMode;
  /** Shown on the right when nothing is picked yet. */
  placeholder?: string;
  /** Earliest selectable ISO date (the boundary itself stays selectable). */
  minDate?: string | null;
  /** Latest selectable ISO date (the boundary itself stays selectable). */
  maxDate?: string | null;
  /** Replaces the mode's built-in shortcuts (e.g. a span's end-date presets). */
  chips?: ReadonlyArray<DateFieldQuickChip>;
  /** Offer a "Bez datuma" row inside the picker. */
  clearable?: boolean;
  disabled?: boolean;
  /** Occupancy dots under the day numbers. On by default except for `dob`. */
  showBusyDots?: boolean;
  /** Leading icon; defaults to a calendar. */
  icon?: ReactNode;
  className?: string;
};

type Step = "day" | "month" | "year";

/** "pon 5." - the chip's secondary line. */
function shortDayLabel(iso: string): string {
  const parts = partsFromIso(iso);
  if (!parts) return "";
  const weekday = WEEKDAY_SHORT_SR[(new Date(parts.year, parts.month, parts.day).getDay() + 6) % 7];
  return `${weekday} ${parts.day}.`;
}

/** "4. avgust 2026." - the field's own value. */
export function formatDateFieldValue(iso: string | null | undefined): string {
  const parts = partsFromIso(iso ?? null);
  if (!parts) return "";
  return `${parts.day}. ${MONTH_NAMES_SR[parts.month]} ${parts.year}.`;
}

/** "4.8.2026." - the compact form for tight rows (start/end pairs). */
export function formatDateFieldValueShort(iso: string | null | undefined): string {
  const parts = partsFromIso(iso ?? null);
  if (!parts) return "";
  return `${parts.day}.${parts.month + 1}.${parts.year}.`;
}

function defaultChips(mode: DateFieldMode, todayIso: string): DateFieldQuickChip[] {
  if (mode === "dob") return [];
  if (mode === "past") {
    return [
      { label: "Danas", iso: todayIso },
      { label: "Juče", iso: shiftIsoByDays(todayIso, -1) ?? todayIso },
      { label: "Prekjuče", iso: shiftIsoByDays(todayIso, -2) ?? todayIso },
    ];
  }
  const parts = partsFromIso(todayIso);
  // Saturday of the current week (or today when it already is the weekend).
  const weekdayIndex = parts ? (new Date(parts.year, parts.month, parts.day).getDay() + 6) % 7 : 0;
  const toSaturday = weekdayIndex <= 5 ? 5 - weekdayIndex : 6;
  const nextMonth = parts ? shiftMonth(parts.year, parts.month, 1) : null;
  return [
    { label: "Danas", iso: todayIso },
    { label: "Sutra", iso: shiftIsoByDays(todayIso, 1) ?? todayIso },
    { label: "Vikend", iso: shiftIsoByDays(todayIso, toSaturday) ?? todayIso },
    { label: "Za 7 dana", iso: shiftIsoByDays(todayIso, 7) ?? todayIso },
    ...(nextMonth
      ? [
          {
            label: "Sledeći mesec",
            iso: isoFromParts(nextMonth.year, nextMonth.month, 1),
          },
        ]
      : []),
  ];
}

/** Year grid range: birth dates reach far back, scheduling stays near. */
function yearRange(mode: DateFieldMode, currentYear: number, cursorYear: number): number[] {
  const first = mode === "dob" ? currentYear : currentYear - 5;
  const last = mode === "dob" ? currentYear - 110 : currentYear - 15;
  const years: number[] = [];
  for (let year = first; year >= last; year -= 1) years.push(year);
  if (!years.includes(cursorYear)) years.push(cursorYear);
  return years.sort((a, b) => b - a);
}

export function DateField({
  id,
  label,
  value,
  onChange,
  mode = "future",
  placeholder = "Izaberi datum",
  minDate,
  maxDate,
  chips,
  clearable = false,
  disabled = false,
  showBusyDots,
  icon,
  className,
}: DateFieldProps) {
  const today = useToday();
  const [open, setOpen] = useState(false);

  const seed = partsFromIso(value) ?? partsFromIso(today.str);
  const [cursor, setCursor] = useState(() => ({
    year: seed?.year ?? new Date().getFullYear(),
    month: seed?.month ?? 0,
  }));
  const [step, setStep] = useState<Step>(mode === "dob" && !value ? "year" : "day");
  const [typed, setTyped] = useState("");

  // Re-seed each time the picker opens: the member may have changed the value
  // through a shortcut chip, or a day may have passed with the form open.
  useEffect(() => {
    if (!open) return;
    const parts = partsFromIso(value) ?? partsFromIso(today.str);
    if (parts) setCursor({ year: parts.year, month: parts.month });
    setStep(mode === "dob" && !value ? "year" : "day");
    setTyped("");
  }, [open, value, today.str, mode]);

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const wantsDots = showBusyDots ?? mode !== "dob";
  const busy: BusyDays = useBusyDays(
    grid[0]?.iso ?? null,
    grid[grid.length - 1]?.iso ?? null,
    open && step === "day" && wantsDots,
  );

  const quickChips = chips ?? defaultChips(mode, today.str);

  const isDisabledDay = useCallback(
    (iso: string) => (minDate ? iso < minDate : false) || (maxDate ? iso > maxDate : false),
    [minDate, maxDate],
  );

  const commit = useCallback(
    (iso: string) => {
      if (isDisabledDay(iso)) return;
      onChange(iso);
      setOpen(false);
    },
    [isDisabledDay, onChange],
  );

  // --- keyboard: roving focus across the day grid ---
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusIndex = (index: number) => {
    const clamped = Math.max(0, Math.min(41, index));
    dayRefs.current[clamped]?.focus();
  };
  const handleGridKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const target = e.target as HTMLElement;
    const index = Number(target.dataset.cellIndex);
    if (Number.isNaN(index)) return;
    const step7 = (delta: number) => {
      e.preventDefault();
      const next = index + delta;
      if (next >= 0 && next <= 41) {
        focusIndex(next);
        return;
      }
      // Walking off either end pages the month and keeps the same weekday.
      const shifted = shiftMonth(cursor.year, cursor.month, next < 0 ? -1 : 1);
      setCursor(shifted);
      requestAnimationFrame(() => focusIndex(next < 0 ? next + 42 : next - 42));
    };
    switch (e.key) {
      case "ArrowLeft":
        step7(-1);
        break;
      case "ArrowRight":
        step7(1);
        break;
      case "ArrowUp":
        step7(-7);
        break;
      case "ArrowDown":
        step7(7);
        break;
      case "Home":
        e.preventDefault();
        focusIndex(index - (index % 7));
        break;
      case "End":
        e.preventDefault();
        focusIndex(index - (index % 7) + 6);
        break;
      case "PageUp":
      case "PageDown": {
        e.preventDefault();
        setCursor(shiftMonth(cursor.year, cursor.month, e.key === "PageUp" ? -1 : 1));
        requestAnimationFrame(() => focusIndex(index));
        break;
      }
      default:
        break;
    }
  };

  const monthCaption = `${MONTH_NAMES_SR[cursor.month][0].toUpperCase()}${MONTH_NAMES_SR[cursor.month].slice(1)}`;

  const trigger = (
    <PickerRow
      id={id}
      title={label}
      icon={icon ?? <CalendarDaysIcon className="size-[17px]" aria-hidden="true" />}
      summary={
        value ? (
          <span className="tabular-nums">{formatDateFieldValue(value)}</span>
        ) : (
          <span className="font-normal">{placeholder}</span>
        )
      }
      disabled={disabled}
      onClick={() => setOpen(true)}
      className={className}
    />
  );

  return (
    <PickerOverlay
      open={open}
      onOpenChange={setOpen}
      title={step === "year" ? "Datum · godina" : step === "month" ? "Datum · mesec" : "Datum"}
      description={
        step === "day"
          ? "Tapni dan - bira se i zatvara. Zaglavlje gore vodi na mesec i godinu."
          : undefined
      }
      trigger={trigger}
    >
      {step === "year" ? (
        <div className="flex flex-col gap-2">
          {mode === "dob" ? (
            <>
              <FormInput
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  const parsed = parseTypedDate(e.target.value, today.date.getFullYear());
                  if (parsed) {
                    const parts = partsFromIso(parsed);
                    if (parts) setCursor({ year: parts.year, month: parts.month });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const parsed = parseTypedDate(typed, today.date.getFullYear());
                  if (parsed) commit(clampIso(parsed, minDate, maxDate));
                }}
                inputMode="numeric"
                placeholder="ili upiši: 15.05.1985"
                aria-label="Upiši datum rođenja"
              />
              {typed && !parseTypedDate(typed, today.date.getFullYear()) ? (
                <FieldHint>Format: dan.mesec.godina - npr. 15.05.1985</FieldHint>
              ) : null}
            </>
          ) : null}
          <FieldGroupLabel>Izaberi godinu</FieldGroupLabel>
          <div className="grid max-h-[46vh] grid-cols-4 gap-1.5 overflow-y-auto overscroll-contain pr-0.5">
            {yearRange(mode, today.date.getFullYear(), cursor.year).map((year) => (
              <Chip
                key={year}
                grow
                selected={year === cursor.year}
                onClick={() => {
                  setCursor((c) => ({ ...c, year }));
                  setStep("month");
                }}
              >
                <span className="tabular-nums">{year}</span>
              </Chip>
            ))}
          </div>
          <FieldHint>
            {mode === "dob"
              ? "Rođendan ide godina -> mesec -> dan. Tri tapa, bez listanja unazad."
              : "Skok na bilo koju godinu - pa mesec, pa dan."}
          </FieldHint>
        </div>
      ) : step === "month" ? (
        <div className="flex flex-col gap-2">
          <PickerRow
            title="Godina"
            icon={<CalendarDaysIcon className="size-[17px]" aria-hidden="true" />}
            summary={<span className="tabular-nums">{cursor.year}.</span>}
            onClick={() => setStep("year")}
          />
          <div className="grid grid-cols-4 gap-1.5">
            {MONTH_SHORT_SR.map((name, index) => (
              <Chip
                key={name}
                grow
                selected={index === cursor.month}
                onClick={() => {
                  setCursor((c) => ({ ...c, month: index }));
                  setStep("day");
                }}
              >
                {name}
              </Chip>
            ))}
          </div>
          <FieldHint>Još samo dan.</FieldHint>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {quickChips.length > 0 ? (
            <ChipRow role="group" aria-label="Brzi izbor datuma">
              {quickChips.map((chip) => (
                <Chip
                  key={`${chip.label}-${chip.iso}`}
                  selected={value === chip.iso}
                  hint={chip.hint ?? shortDayLabel(chip.iso)}
                  disabled={isDisabledDay(chip.iso)}
                  onClick={() => commit(chip.iso)}
                >
                  {chip.label}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStep("month")}
              className="flex min-h-11 items-baseline gap-2 rounded-md px-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label="Promeni mesec i godinu"
            >
              <span className="font-serif text-xl font-bold tracking-tight">{monthCaption}</span>
              <span className="text-sm font-bold text-muted-foreground tabular-nums">
                {cursor.year}.
              </span>
              <ChevronDownIcon
                className="size-4 self-center text-muted-foreground"
                aria-hidden="true"
              />
            </button>
            <span className="flex-1" />
            <button
              type="button"
              aria-label="Prethodni mesec"
              onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))}
              className="grid size-11 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Sledeći mesec"
              onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))}
              className="grid size-11 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5" aria-hidden="true">
            {WEEKDAY_SHORT_SR.map((day) => (
              <div
                key={day}
                className="py-1 text-center text-[10px] font-bold tracking-wide text-muted-foreground uppercase"
              >
                {day}
              </div>
            ))}
          </div>

          <div
            role="group"
            aria-label={`${monthCaption} ${cursor.year}.`}
            className="grid grid-cols-7 gap-0.5"
          >
            {grid.map((cell, index) => {
              const selected = value === cell.iso;
              const isToday = cell.iso === today.str;
              const dots = Math.min(3, busy.get(cell.iso) ?? 0);
              const cellDisabled = isDisabledDay(cell.iso);
              const cellParts = partsFromIso(cell.iso);
              return (
                <button
                  key={cell.iso}
                  ref={(node) => {
                    dayRefs.current[index] = node;
                  }}
                  type="button"
                  data-cell-index={index}
                  tabIndex={selected || (!value && isToday) ? 0 : -1}
                  aria-pressed={selected}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${cell.day}. ${MONTH_NAMES_SR[cellParts?.month ?? cursor.month]} ${cellParts?.year ?? cursor.year}.`}
                  disabled={cellDisabled}
                  onKeyDown={handleGridKeyDown}
                  onClick={() => commit(cell.iso)}
                  className={cn(
                    "flex aspect-[1.15] min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border border-transparent text-sm font-semibold tabular-nums transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    "disabled:pointer-events-none disabled:opacity-25",
                    !cell.inMonth && "opacity-40",
                    selected
                      ? "border-accent bg-accent text-accent-foreground"
                      : isToday
                        ? "border-accent text-accent-deep"
                        : "hover:bg-muted",
                  )}
                >
                  <span>{cell.day}</span>
                  <span className="flex h-1 gap-[2px]" aria-hidden="true">
                    {Array.from({ length: dots }, (_, dot) => (
                      <i
                        key={dot}
                        className={cn(
                          "size-1 rounded-full",
                          selected ? "bg-accent-foreground" : "bg-muted-foreground/60",
                        )}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {clearable && value ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="min-h-11 rounded-lg border border-border bg-card text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Bez datuma
            </button>
          ) : null}
        </div>
      )}
    </PickerOverlay>
  );
}
