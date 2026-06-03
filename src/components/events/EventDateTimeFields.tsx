import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import type { Event } from "@/types/database";

/**
 * The date + time portion of an event, shared by the create/edit form's
 * scheduling block and the "Pomeri" (reschedule) surfaces. `allDay` is the
 * derived "both times null" state; when on, the time pickers hide and the
 * payload resolves start/end to null.
 */
export type EventDateTimeValue = {
  date: string | null;
  allDay: boolean;
  start_time: string | null;
  end_time: string | null;
};

export function eventToDateTimeValue(event: Event | null | undefined): EventDateTimeValue {
  return {
    date: event?.date ?? null,
    allDay: event ? event.start_time == null && event.end_time == null : true,
    start_time: event?.start_time ?? null,
    end_time: event?.end_time ?? null,
  };
}

/** Resolve the value to the event columns, collapsing all-day to null times. */
export function dateTimeValueToColumns(value: EventDateTimeValue): {
  date: string;
  start_time: string | null;
  end_time: string | null;
} {
  const start = (value.start_time ?? "").trim();
  return {
    date: value.date as string,
    start_time: value.allDay ? null : start || null,
    end_time: value.allDay ? null : (value.end_time ?? "").trim() || null,
  };
}

export type EventDateTimeFieldsProps = {
  value: EventDateTimeValue;
  onChange: (value: EventDateTimeValue) => void;
  /** Prefix so multiple instances on one screen keep unique input ids. */
  idPrefix?: string;
};

export function EventDateTimeFields({
  value,
  onChange,
  idPrefix = "dt",
}: EventDateTimeFieldsProps) {
  const patch = (partial: Partial<EventDateTimeValue>) => onChange({ ...value, ...partial });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-date`}>Datum *</Label>
        <DatePicker
          id={`${idPrefix}-date`}
          value={value.date}
          onChange={(date) => patch({ date })}
          placeholder="Izaberi datum"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id={`${idPrefix}-all-day`}
          type="checkbox"
          checked={value.allDay}
          onChange={(e) => patch({ allDay: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
        />
        <Label htmlFor={`${idPrefix}-all-day`} className="cursor-pointer font-normal">
          Ceo dan
        </Label>
      </div>
      {!value.allDay ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-start`}>Početak (opciono)</Label>
            <TimePicker
              id={`${idPrefix}-start`}
              value={value.start_time}
              onChange={(start_time) => patch({ start_time })}
              placeholder="00:00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-end`}>Završetak (opciono)</Label>
            <TimePicker
              id={`${idPrefix}-end`}
              value={value.end_time}
              onChange={(end_time) => patch({ end_time })}
              placeholder="00:00"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
