import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { EventListItem } from "@/components/events/EventListItem";
import type { EventFormPayload } from "@/components/events/EventForm";
import { useCreateEvent, useDeleteEvent, useEventsList, useUpdateEvent } from "@/hooks/useEvents";
import type { Event } from "@/types/database";
import { isEventEnded } from "@/utils/event";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/_app/events")({
  component: EventsPage,
});

function EventsPage() {
  // Filter state. `null` means "no bound" — passed as `undefined` into the
  // query hook so it's omitted from the Supabase query entirely. The
  // checkbox filters the already-fetched list client-side (mirrors Vue).
  const [hideCompleted, setHideCompleted] = useState(true);
  const [filterFrom, setFilterFrom] = useState<string | null>(null);
  const [filterTo, setFilterTo] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);

  const eventsQuery = useEventsList({
    from: filterFrom ?? undefined,
    to: filterTo ?? undefined,
  });
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const events: Event[] = eventsQuery.data ?? [];
  const filteredEvents = hideCompleted ? events.filter((e) => !isEventEnded(e)) : events;

  const openAdd = () => {
    setEditingEvent(null);
    setErrorMessage(null);
    setDialogOpen(true);
  };

  const openEdit = (eventItem: Event) => {
    setEditingEvent(eventItem);
    setErrorMessage(null);
    setDialogOpen(true);
  };

  const clearFilters = () => {
    setFilterFrom(null);
    setFilterTo(null);
  };

  const handleSubmit = async (payload: EventFormPayload) => {
    setErrorMessage(null);
    try {
      if (editingEvent) {
        await updateEvent.mutateAsync({ id: editingEvent.id, payload });
      } else {
        await createEvent.mutateAsync(payload);
      }
      setDialogOpen(false);
      setEditingEvent(null);
    } catch (err) {
      const fallback = editingEvent
        ? "Greška pri ažuriranju događaja"
        : "Greška pri kreiranju događaja";
      setErrorMessage(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const confirmDelete = (eventItem: Event) => {
    setEventToDelete(eventItem);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!eventToDelete) return;
    try {
      await deleteEvent.mutateAsync(eventToDelete.id);
      setDeleteDialogOpen(false);
      setEventToDelete(null);
    } catch {
      // Toast surfaced by the hook's onError handler; keep the dialog open
      // so the user can retry or cancel.
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingEvent(null);
      setErrorMessage(null);
    }
  };

  const deleteConfirmMessage = `Da li ste sigurni da želite da obrišete "${
    eventToDelete?.name ?? ""
  }"?`;

  const isLoading = eventsQuery.isLoading;
  const showEmpty = !isLoading && filteredEvents.length === 0;

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Događaji</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(e) => setHideCompleted(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
            />
            Sakrij završene
          </label>
          <Button onClick={openAdd}>
            <PlusIcon className="mr-2 h-5 w-5" />
            Dodaj događaj
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <Label htmlFor="from" className="shrink-0">
            Od
          </Label>
          <DatePicker
            id="from"
            value={filterFrom}
            onChange={setFilterFrom}
            placeholder="Od"
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="to" className="shrink-0">
            Do
          </Label>
          <DatePicker
            id="to"
            value={filterTo}
            onChange={setFilterTo}
            placeholder="Do"
            className="w-40"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={clearFilters}>
          Prikaži sve
        </Button>
      </div>

      {isLoading ? <div className="mt-6 text-gray-500">Učitavanje…</div> : null}

      {showEmpty ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          Nema događaja za prikaz. Dodajte prvi događaj.
        </div>
      ) : null}

      {!isLoading && filteredEvents.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {filteredEvents.map((eventItem) => {
            const ended = isEventEnded(eventItem);
            return (
              <li
                key={eventItem.id}
                className={cn(
                  "rounded-lg border p-4 shadow-sm dark:border-gray-700",
                  ended
                    ? "border-gray-200/80 bg-gray-50 opacity-75 dark:bg-gray-800/80"
                    : "border-gray-200 bg-white dark:bg-gray-800",
                )}
              >
                <EventListItem event={eventItem} onEdit={openEdit} onDelete={confirmDelete} />
              </li>
            );
          })}
        </ul>
      ) : null}

      <EventFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        event={editingEvent}
        error={errorMessage}
        saving={createEvent.isPending || updateEvent.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setEventToDelete(null);
        }}
        title="Obriši događaj"
        message={deleteConfirmMessage}
        loading={deleteEvent.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />
    </div>
  );
}
