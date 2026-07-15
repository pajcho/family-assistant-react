import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  EyeSlashIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import type { Birthday, Event } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddButton } from "@/components/common/AddButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ALL_MONTHS, MonthPicker } from "@/components/common/PeriodPicker";
import { ToggleChip } from "@/components/common/ToggleChip";
import { BirthdayListItem } from "@/components/birthdays/BirthdayListItem";
import {
  BirthdayFormDialog,
  type BirthdayFormDialogProps,
} from "@/components/birthdays/BirthdayFormDialog";
import { type BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import type { EventFormPayload } from "@/components/events/EventForm";
import {
  useBirthdaysList,
  useCreateBirthday,
  useUpdateBirthday,
  useDeleteBirthday,
} from "@/hooks/useBirthdays";
import { useBirthdayCelebrations, useCreateEvent, useUpdateEvent } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { daysUntilBirthday, nextBirthdayDate } from "@/utils/birthday";

/**
 * `/birthdays` — list + CRUD for the family's birthdays.
 *
 * Direct port of `pages/birthdays/index.vue`. Data and realtime are owned by
 * the Phase 2C hooks; the sort by "days until next birthday" lives here
 * because the DB query orders by `birth_date` ASC (the order field is the
 * literal calendar date, not "next occurrence relative to today").
 */
export const Route = createFileRoute("/_app/birthdays")({
  component: BirthdaysPage,
});

/** Minimum characters before the client-side search kicks in. */
const MIN_SEARCH_CHARS = 2;

function BirthdaysPage() {
  const { data: birthdays, isLoading } = useBirthdaysList();
  const createMutation = useCreateBirthday();
  const updateMutation = useUpdateBirthday();
  const deleteMutation = useDeleteBirthday();

  // Filters — the shared control set: a month picker CLAMPED to the current
  // year (birthdays repeat annually, so "Avg" means "this year's August"),
  // defaulting to "Svi rođendani"; a text search; and a "Sakrij prošle"
  // toggle for birthdays whose date this year has already passed.
  const currentYear = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState<string>(ALL_MONTHS);
  const [searchTerm, setSearchTerm] = useState("");
  const [hidePassed, setHidePassed] = useState(false);
  const searchActive = searchTerm.trim().length >= MIN_SEARCH_CHARS;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState<Birthday | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [birthdayToDelete, setBirthdayToDelete] = useState<Birthday | null>(null);

  // "Organizuj proslavu" — the event form opens prefilled with the person's
  // next birthday; the created event carries `birthday_id` so the row can show
  // the celebration chip. The same dialog re-opens an existing celebration.
  const [organizingFor, setOrganizingFor] = useState<Birthday | null>(null);
  const [editingCelebration, setEditingCelebration] = useState<Event | null>(null);
  const [celebrationError, setCelebrationError] = useState<string | null>(null);
  const { data: celebrationByBirthday } = useBirthdayCelebrations();
  const { byEvent } = useEventParticipants();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();

  // Filter (month within this year / search / hide-passed), then sort. Search
  // matches name + description and ignores the other filters. Default sort is
  // "soonest next birthday first"; with a month selected, day-of-month order
  // reads more naturally.
  const filteredBirthdays = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = (birthdays ?? []).filter((b) => {
      if (searchActive) {
        return b.name.toLowerCase().includes(q) || (b.description ?? "").toLowerCase().includes(q);
      }
      if (selectedMonth !== ALL_MONTHS && b.birth_date.slice(5, 7) !== selectedMonth.slice(5, 7)) {
        return false;
      }
      // Passed this year ⇔ the next occurrence already rolled into next year.
      if (hidePassed && nextBirthdayDate(b.birth_date).getFullYear() !== currentYear) return false;
      return true;
    });
    if (!searchActive && selectedMonth !== ALL_MONTHS) {
      return list.toSorted((a, b) =>
        a.birth_date.slice(8, 10).localeCompare(b.birth_date.slice(8, 10)),
      );
    }
    return list.toSorted(
      (a, b) => daysUntilBirthday(a.birth_date) - daysUntilBirthday(b.birth_date),
    );
  }, [birthdays, searchActive, searchTerm, selectedMonth, hidePassed, currentYear]);

  const openAdd = () => {
    setEditingBirthday(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (birthday: Birthday) => {
    setEditingBirthday(birthday);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSubmit: BirthdayFormDialogProps["onSubmit"] = async (
    payload: BirthdayFormPayload,
  ) => {
    setFormError(null);
    try {
      if (editingBirthday) {
        await updateMutation.mutateAsync({ id: editingBirthday.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      setDialogOpen(false);
      setEditingBirthday(null);
    } catch (err) {
      // The mutation hooks already toast on error; mirror the Vue page by
      // surfacing the message inline at the top of the dialog as well.
      const message =
        err instanceof Error
          ? err.message
          : editingBirthday
            ? "Greška pri ažuriranju rođendana"
            : "Greška pri kreiranju rođendana";
      setFormError(message);
    }
  };

  const handleDialogOpenChange = (next: boolean) => {
    setDialogOpen(next);
    if (!next) {
      setFormError(null);
      setEditingBirthday(null);
    }
  };

  const confirmDelete = (birthday: Birthday) => {
    setBirthdayToDelete(birthday);
    setDeleteDialogOpen(true);
  };

  const doDelete = async () => {
    if (!birthdayToDelete) return;
    try {
      await deleteMutation.mutateAsync(birthdayToDelete.id);
      setDeleteDialogOpen(false);
      setBirthdayToDelete(null);
    } catch {
      // Mutation hook already toasts; keep the dialog open so the user can retry.
    }
  };

  const handleDeleteOpenChange = (next: boolean) => {
    setDeleteDialogOpen(next);
    if (!next) setBirthdayToDelete(null);
  };

  const handleCelebrationSubmit = async (payload: EventFormPayload) => {
    setCelebrationError(null);
    try {
      if (editingCelebration) {
        await updateEvent.mutateAsync({ id: editingCelebration.id, payload });
      } else if (organizingFor) {
        await createEvent.mutateAsync({ ...payload, birthday_id: organizingFor.id });
      }
      setOrganizingFor(null);
      setEditingCelebration(null);
    } catch (err) {
      const fallback = editingCelebration
        ? "Greška pri izmeni proslave"
        : "Greška pri kreiranju proslave";
      setCelebrationError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const handleCelebrationOpenChange = (next: boolean) => {
    if (!next) {
      setOrganizingFor(null);
      setEditingCelebration(null);
      setCelebrationError(null);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Rođendani</h1>
        <AddButton label="Dodaj rođendan" onClick={openAdd} />
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            allOptionLabel="Svi rođendani"
            minMonth={`${currentYear}-01`}
            maxMonth={`${currentYear}-12`}
          />
          <div className="relative min-w-0 flex-1 basis-52">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pretraži rođendane…"
              aria-label="Pretraži rođendane"
              className="pl-9"
            />
            {searchTerm ? (
              <button
                type="button"
                aria-label="Obriši pretragu"
                onClick={() => setSearchTerm("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100"
              >
                <XMarkIcon className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <ToggleChip
          active={hidePassed}
          onToggle={() => setHidePassed((prev) => !prev)}
          icon={EyeSlashIcon}
        >
          Sakrij prošle ove godine
        </ToggleChip>
      </div>

      {isLoading ? (
        <div className="mt-6 text-gray-500 dark:text-gray-400">Učitavanje…</div>
      ) : (birthdays ?? []).length === 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-500 dark:text-gray-400">Nema unetih rođendana.</p>
          <Button onClick={openAdd} className="mt-4">
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj rođendan
          </Button>
        </div>
      ) : filteredBirthdays.length === 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          {searchActive
            ? "Nema rođendana koji odgovaraju pretrazi."
            : "Nema rođendana za izabrane filtere."}
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {filteredBirthdays.map((b) => (
            <li
              key={b.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <BirthdayListItem
                birthday={b}
                celebration={celebrationByBirthday?.get(b.id) ?? null}
                onEdit={openEdit}
                onDelete={confirmDelete}
                onOrganize={(birthday) => {
                  setCelebrationError(null);
                  setEditingCelebration(null);
                  setOrganizingFor(birthday);
                }}
                onOpenCelebration={(event) => {
                  setCelebrationError(null);
                  setOrganizingFor(null);
                  setEditingCelebration(event);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <BirthdayFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        birthday={editingBirthday}
        error={formError}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={handleDeleteOpenChange}
        title="Obriši rođendan"
        message={`Da li ste sigurni da želite da obrišete "${birthdayToDelete?.name ?? ""}"?`}
        loading={deleteMutation.isPending}
        onConfirm={doDelete}
      />

      <EventFormDialog
        open={!!organizingFor || !!editingCelebration}
        onOpenChange={handleCelebrationOpenChange}
        event={editingCelebration}
        initialPersonIds={editingCelebration ? (byEvent.get(editingCelebration.id) ?? []) : []}
        defaults={
          organizingFor
            ? {
                name: `Proslava — ${organizingFor.name}`,
                date: format(nextBirthdayDate(organizingFor.birth_date), "yyyy-MM-dd"),
              }
            : undefined
        }
        title={organizingFor ? "Organizuj proslavu" : "Izmeni proslavu"}
        error={celebrationError}
        saving={createEvent.isPending || updateEvent.isPending}
        onSubmit={(payload) => {
          void handleCelebrationSubmit(payload);
        }}
      />
    </div>
  );
}
