import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReminderSelect } from "@/components/ui/reminder-select";
import { TimePicker } from "@/components/ui/time-picker";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import type { Event } from "@/types/database";

export type EventFormPayload = {
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  remind_minutes_before: number | null;
  /** Family members the event is for. Empty = unassigned (family-wide). */
  personIds: string[];
  /**
   * Set to `null` only when a full-form edit changed the date/time — clearing
   * any stale "Razlog pomeranja" so it can't outlive the move it described.
   * Omitted otherwise (leaves the stored value untouched).
   */
  reschedule_reason?: string | null;
};

export type EventFormProps = {
  event?: Event | null;
  /** Assignees for the event being edited; empty/omitted for a new event. */
  initialPersonIds?: string[];
  /**
   * Prefill for ADD mode only (ignored while editing) — e.g. "Organizuj
   * proslavu" seeds the name and the next birthday date. The form still
   * submits as a create.
   */
  defaults?: Partial<Pick<Event, "name" | "description" | "date" | "notes">>;
  saving?: boolean;
  onSubmit: (payload: EventFormPayload) => void;
  onCancel: () => void;
};

type FormState = {
  name: string;
  description: string;
  date: string | null;
  allDay: boolean;
  start_time: string | null;
  end_time: string | null;
  notes: string;
  remind_minutes_before: number | null;
  personIds: string[];
};

function initialState(
  event: Event | null | undefined,
  personIds: string[],
  defaults?: EventFormProps["defaults"],
): FormState {
  return {
    name: event?.name ?? defaults?.name ?? "",
    description: event?.description ?? defaults?.description ?? "",
    date: event?.date ?? defaults?.date ?? null,
    // New events default to "not all day" (matching the Vue form);
    // existing events derive allDay from whether both times are null.
    allDay: event ? event.start_time == null && event.end_time == null : false,
    start_time: event?.start_time ?? null,
    end_time: event?.end_time ?? null,
    notes: event?.notes ?? defaults?.notes ?? "",
    remind_minutes_before: event?.remind_minutes_before ?? null,
    personIds,
  };
}

/**
 * Direct port of `components/events/EventForm.vue` from the sibling Nuxt app.
 *
 * Controlled inputs (per the migration plan's "no react-hook-form" stack
 * decision). Submitting fires `onSubmit` with a serialized payload — the
 * dialog wrapper owns the mutation call so this component stays pure.
 */
export function EventForm({
  event,
  initialPersonIds,
  defaults,
  saving = false,
  onSubmit,
  onCancel,
}: EventFormProps) {
  const [form, setForm] = useState<FormState>(() =>
    initialState(event, initialPersonIds ?? [], defaults),
  );

  // Serialized so the effect reseeds when the assignees finish loading
  // (the parent looks them up from a query that resolves after open) without
  // firing on every render from a fresh array reference.
  const personSeed = (initialPersonIds ?? []).join(",");
  const defaultsSeed = defaults ? JSON.stringify(defaults) : "";

  // When the parent swaps `event` (e.g. opening edit vs. switching between
  // events without unmounting the form), reseed local state. Mirrors Vue's
  // `watch(() => props.event, ..., { immediate: true })`.
  useEffect(() => {
    setForm(
      initialState(
        event,
        personSeed ? personSeed.split(",") : [],
        defaultsSeed ? (JSON.parse(defaultsSeed) as EventFormProps["defaults"]) : undefined,
      ),
    );
  }, [event, personSeed, defaultsSeed]);

  const isEdit = !!event?.id;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim() || !form.date) return;
    const startTime = (form.start_time ?? "").trim();
    const endTime = (form.end_time ?? "").trim();
    const resolvedStart = form.allDay ? null : startTime || null;
    const resolvedEnd = form.allDay ? null : endTime || null;
    // A full-form edit that shifts the date/time is itself a "move", so any
    // reschedule reason left over from an earlier "Pomeri" no longer matches
    // the new date — drop it (mirrors how the Pomeri dialogs overwrite it).
    // Untouched otherwise so a pure name/notes edit keeps a legitimate reason.
    const scheduleChanged =
      !!event &&
      (form.date !== event.date ||
        resolvedStart !== (event.start_time ?? null) ||
        resolvedEnd !== (event.end_time ?? null));
    onSubmit({
      name: form.name.trim(),
      description: form.description.trim() || null,
      date: form.date,
      start_time: resolvedStart,
      end_time: resolvedEnd,
      notes: form.notes.trim() || null,
      // Reminders only fire when there's a wall-clock start_time to
      // anchor the offset against — clear the field if the user toggled
      // back to all-day or removed the start time after picking one.
      remind_minutes_before: resolvedStart ? form.remind_minutes_before : null,
      personIds: form.personIds,
      ...(scheduleChanged ? { reschedule_reason: null } : {}),
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="name">Naziv *</Label>
        <Input
          id="name"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          required
          placeholder="npr. Marko rođendan"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Opis</Label>
        <Input
          id="description"
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          placeholder="detalji događaja"
        />
      </div>
      <MemberMultiSelect
        label="Za koga (opciono)"
        value={form.personIds}
        onChange={(personIds) => setForm((s) => ({ ...s, personIds }))}
      />
      <div className="space-y-2">
        <Label htmlFor="date">Datum *</Label>
        <DatePicker
          id="date"
          value={form.date}
          onChange={(value) => setForm((s) => ({ ...s, date: value }))}
          placeholder="Izaberi datum"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="all_day"
          type="checkbox"
          checked={form.allDay}
          onChange={(e) => setForm((s) => ({ ...s, allDay: e.target.checked }))}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
        />
        <Label htmlFor="all_day" className="cursor-pointer font-normal">
          Ceo dan
        </Label>
      </div>
      {!form.allDay && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">Početak (opciono)</Label>
              <TimePicker
                id="start_time"
                value={form.start_time}
                onChange={(value) => setForm((s) => ({ ...s, start_time: value }))}
                placeholder="00:00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">Završetak (opciono)</Label>
              <TimePicker
                id="end_time"
                value={form.end_time}
                onChange={(value) => setForm((s) => ({ ...s, end_time: value }))}
                placeholder="00:00"
              />
            </div>
          </div>
          {form.start_time ? (
            <div className="space-y-2">
              <Label htmlFor="reminder">Podsetnik</Label>
              <ReminderSelect
                id="reminder"
                value={form.remind_minutes_before}
                onChange={(value) => setForm((s) => ({ ...s, remind_minutes_before: value }))}
              />
            </div>
          ) : null}
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor="notes">Napomene (poklon, itd.)</Label>
        <Input
          id="notes"
          value={form.notes}
          onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
          placeholder="npr. Kupljena knjiga, ostalo za pakovanje"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Odustani
        </Button>
        <Button type="submit" disabled={saving}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
