import * as React from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import type { Event } from "@/types/database";

export type EventFormPayload = {
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
};

export type EventFormProps = {
  event?: Event | null;
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
};

function initialState(event: Event | null | undefined): FormState {
  return {
    name: event?.name ?? "",
    description: event?.description ?? "",
    date: event?.date ?? null,
    // New events default to "not all day" (matching the Vue form);
    // existing events derive allDay from whether both times are null.
    allDay: event ? event.start_time == null && event.end_time == null : false,
    start_time: event?.start_time ?? null,
    end_time: event?.end_time ?? null,
    notes: event?.notes ?? "",
  };
}

/**
 * Direct port of `components/events/EventForm.vue` from the sibling Nuxt app.
 *
 * Controlled inputs (per the migration plan's "no react-hook-form" stack
 * decision). Submitting fires `onSubmit` with a serialized payload — the
 * dialog wrapper owns the mutation call so this component stays pure.
 */
export function EventForm({ event, saving = false, onSubmit, onCancel }: EventFormProps) {
  const [form, setForm] = React.useState<FormState>(() => initialState(event));

  // When the parent swaps `event` (e.g. opening edit vs. switching between
  // events without unmounting the form), reseed local state. Mirrors Vue's
  // `watch(() => props.event, ..., { immediate: true })`.
  React.useEffect(() => {
    setForm(initialState(event));
  }, [event]);

  const isEdit = !!event?.id;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim() || !form.date) return;
    const startTime = (form.start_time ?? "").trim();
    const endTime = (form.end_time ?? "").trim();
    onSubmit({
      name: form.name.trim(),
      description: form.description.trim() || null,
      date: form.date,
      start_time: form.allDay ? null : startTime || null,
      end_time: form.allDay ? null : endTime || null,
      notes: form.notes.trim() || null,
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
          Otkaži
        </Button>
        <Button type="submit" disabled={saving}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
