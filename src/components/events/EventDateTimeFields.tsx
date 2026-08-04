import { SunIcon } from "@heroicons/react/24/outline";

import { DateField } from "@/components/common/DateField";
import { PickerRowPair } from "@/components/common/PickerRow";
import { SwitchRow } from "@/components/common/SwitchRow";
import { DurationChips, TimeField } from "@/components/common/TimeField";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import { eventDurationLabel, isMultiDayEvent, shiftedEventEndDate } from "@/utils/event";

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

/**
 * Under the reschedule fields of a multi-day event: the whole span moves and
 * keeps its length (see `shiftedEventEndDate`), so spell out where it will
 * now end. Renders nothing for single-day events. Shared by both event
 * detail dialogs' "Pomeri" views.
 */
export function RescheduleSpanNote({ event, newDate }: { event: Event; newDate: string | null }) {
  if (!isMultiDayEvent(event)) return null;
  const newEnd = newDate ? shiftedEventEndDate(event, newDate) : null;
  return (
    <p className="text-xs text-muted-foreground">
      Višednevni događaj ({eventDurationLabel(event)}) - pomera se ceo period
      {newEnd ? `, novi poslednji dan: ${formatDate(newEnd)}` : ""}.
    </p>
  );
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
    <div className="space-y-3">
      <DateField
        id={`${idPrefix}-date`}
        label="Datum *"
        value={value.date}
        onChange={(date) => patch({ date })}
        placeholder="Izaberi datum"
      />
      <SwitchRow
        icon={SunIcon}
        title="Ceo dan"
        checked={value.allDay}
        onChange={(allDay) => patch({ allDay })}
      />
      {!value.allDay ? (
        <div className="space-y-2">
          <PickerRowPair>
            <TimeField
              id={`${idPrefix}-start`}
              label="Početak"
              value={value.start_time}
              onChange={(start_time) => patch({ start_time })}
              clearable
            />
            <TimeField
              id={`${idPrefix}-end`}
              label="Kraj"
              value={value.end_time}
              onChange={(end_time) => patch({ end_time })}
              clearable
            />
          </PickerRowPair>
          <DurationChips
            start={value.start_time}
            end={value.end_time}
            onChangeEnd={(end_time) => patch({ end_time })}
          />
        </div>
      ) : null}
    </div>
  );
}
