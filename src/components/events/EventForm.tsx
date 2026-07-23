import type { Dispatch, FormEvent, SetStateAction } from "react";
import { AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENT_REMINDER_OPTIONS, ReminderSelect } from "@/components/ui/reminder-select";
import { TimePicker } from "@/components/ui/time-picker";
import { useIsDesktop } from "@/components/ui/responsive-dialog";
import { DateQuickPick } from "@/components/common/DateQuickPick";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import { PickerRow } from "@/components/common/PickerRow";
import { SwitchRow } from "@/components/common/SwitchRow";
import type { Event } from "@/types/database";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { getDisplayName } from "@/utils/identity";

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
   * Set to `null` only when a full-form edit changed the date/time - clearing
   * any stale "Razlog pomeranja" so it can't outlive the move it described.
   * Omitted otherwise (leaves the stored value untouched).
   */
  reschedule_reason?: string | null;
};

/** ADD-mode prefill (e.g. "Organizuj proslavu" seeds name + date). */
export type EventFormDefaults = Partial<Pick<Event, "name" | "description" | "date" | "notes">>;

export type EventFormState = {
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

/** Mobile sub-views the form's picker row can open - see EventFormDialog. */
export type EventFormViewKind = "details";

/**
 * Seed for the dialog-owned form state. `today` pre-fills the date when
 * ADDING without an explicit default - same convention as payments.
 */
export function initialEventFormState(
  event: Event | null | undefined,
  personIds: string[],
  defaults: EventFormDefaults | undefined,
  today: string,
): EventFormState {
  return {
    name: event?.name ?? defaults?.name ?? "",
    description: event?.description ?? defaults?.description ?? "",
    date: event?.date ?? defaults?.date ?? today,
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

export type EventFormProps = {
  /** Dialog-owned state - survives the SheetStack mobile close→reopen hop. */
  form: EventFormState;
  setForm: Dispatch<SetStateAction<EventFormState>>;
  event?: Event | null;
  /** Kept for the dialog's prop type; seeding happens in the dialog. */
  defaults?: EventFormDefaults;
  saving?: boolean;
  onSubmit: (payload: EventFormPayload) => void;
  onCancel: () => void;
  /** Mobile "Brzi unos" row pushes the Detalji sub-view (dialog's SheetStack). */
  onOpenView: (view: EventFormViewKind) => void;
};

/**
 * Mobile (<sm) - the "Brzi unos" layout: Naziv, Datum (danas + quick chips),
 * the Ceo dan switch and (when timed) Početak/Završetak stay inline; Opis,
 * Za koga, Podsetnik and Napomene move behind a "Više detalja" row into a
 * sub-view. The Odustani/Dodaj bar is pinned by the dialog below the scroll
 * area.
 *
 * Desktop (sm+) - the classic fully-expanded layout, unchanged.
 */
export function EventForm({
  form,
  setForm,
  event,
  saving = false,
  onSubmit,
  onCancel,
  onOpenView,
}: EventFormProps) {
  const isDesktop = useIsDesktop();
  const { members } = useFamilyMembers();

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
    // the new date - drop it (mirrors how the Pomeri dialogs overwrite it).
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
      // anchor the offset against - clear the field if the user toggled
      // back to all-day or removed the start time after picking one.
      remind_minutes_before: resolvedStart ? form.remind_minutes_before : null,
      personIds: form.personIds,
      ...(scheduleChanged ? { reschedule_reason: null } : {}),
    });
  };

  const timeGrid = !form.allDay ? (
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
  ) : null;

  // Reminders anchor to a wall-clock start_time, so the field only makes
  // sense once one is set. Desktop renders it inline under the time grid;
  // mobile surfaces it in the "Više detalja" sub-view (see EventFormDialog).
  const reminderField =
    !form.allDay && form.start_time ? (
      <div className="space-y-2">
        <Label htmlFor="reminder">Podsetnik</Label>
        <ReminderSelect
          id="reminder"
          value={form.remind_minutes_before}
          onChange={(value) => setForm((s) => ({ ...s, remind_minutes_before: value }))}
        />
      </div>
    ) : null;

  if (!isDesktop) {
    // --- Mobile: "Brzi unos" ---
    const detailParts: string[] = [];
    if (form.description.trim()) detailParts.push("Opis ✓");
    if (form.personIds.length > 0) {
      const names = form.personIds
        .map((id) => {
          const person = members.find((m) => m.id === id);
          return person
            ? getDisplayName({
                firstName: person.first_name,
                lastName: person.last_name,
                email: null,
              })
            : null;
        })
        .filter(Boolean);
      detailParts.push(names.length > 0 ? names.join(", ") : `Za koga: ${form.personIds.length}`);
    }
    // Reminder only counts when it can actually fire (a start_time is set).
    const hasReminder = !form.allDay && !!form.start_time && form.remind_minutes_before != null;
    if (hasReminder) {
      const reminder = EVENT_REMINDER_OPTIONS.find((o) => o.value === form.remind_minutes_before);
      if (reminder) detailParts.push(reminder.label);
    }
    if (form.notes.trim()) detailParts.push("Napomene ✓");
    const detailCount =
      (form.description.trim() ? 1 : 0) +
      (form.personIds.length > 0 ? 1 : 0) +
      (hasReminder ? 1 : 0) +
      (form.notes.trim() ? 1 : 0);

    return (
      <form id="event-form" className="space-y-4" onSubmit={handleSubmit}>
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
        <DateQuickPick
          id="date"
          label="Datum *"
          value={form.date}
          onChange={(value) => setForm((s) => ({ ...s, date: value }))}
          placeholder="Izaberi datum"
        />
        <SwitchRow
          title="Ceo dan"
          description="Bez početka i završetka - događaj važi ceo dan."
          checked={form.allDay}
          onChange={(allDay) => setForm((s) => ({ ...s, allDay }))}
        />
        {timeGrid}
        <PickerRow
          title="Više detalja"
          summary={detailParts.length > 0 ? detailParts.join(" · ") : "Opis · za koga · napomene"}
          icon={<AdjustmentsHorizontalIcon className="size-4" />}
          count={detailCount}
          onClick={() => onOpenView("details")}
        />
      </form>
    );
  }

  // --- Desktop: classic fully-expanded layout (unchanged) ---
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
      {timeGrid}
      {reminderField}
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
