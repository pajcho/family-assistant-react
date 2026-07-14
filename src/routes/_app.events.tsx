import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EyeSlashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { AddButton } from "@/components/common/AddButton";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PersonFilterChips } from "@/components/common/PersonFilterChips";
import { EventCancelDialog } from "@/components/events/EventCancelDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { EventListItem } from "@/components/events/EventListItem";
import {
  EventRescheduleDialog,
  type EventReschedulePayload,
} from "@/components/events/EventRescheduleDialog";
import type { EventFormPayload } from "@/components/events/EventForm";
import { useCreateEvent, useDeleteEvent, useEventsList, useUpdateEvent } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
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
  // Person filter — same convention as the dashboard's person facet: an empty
  // set means "no filter"; a non-empty set narrows to those members.
  const [selectedPersonIds, setSelectedPersonIds] = useState<ReadonlySet<string>>(() => new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);

  // Quick-reschedule state
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [eventToReschedule, setEventToReschedule] = useState<Event | null>(null);

  // Cancel-with-reason state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [eventToCancel, setEventToCancel] = useState<Event | null>(null);

  const eventsQuery = useEventsList({
    from: filterFrom ?? undefined,
    to: filterTo ?? undefined,
  });
  const { byEvent } = useEventParticipants();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const events = useMemo<Event[]>(() => eventsQuery.data ?? [], [eventsQuery.data]);
  // "Sakrij završene" + the person facet. Person semantics mirror the
  // dashboard's `matchesAgendaFilter`: empty selection shows everything; with
  // members selected only events assigned to at least one of them pass
  // (unassigned events hide while the filter is active).
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (hideCompleted && isEventEnded(e)) return false;
      if (selectedPersonIds.size > 0) {
        const personIds = byEvent.get(e.id) ?? [];
        if (!personIds.some((id) => selectedPersonIds.has(id))) return false;
      }
      return true;
    });
  }, [events, hideCompleted, selectedPersonIds, byEvent]);
  const editingPersonIds = editingEvent ? (byEvent.get(editingEvent.id) ?? []) : [];

  const togglePerson = (personId: string) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

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

  const openReschedule = (eventItem: Event) => {
    setEventToReschedule(eventItem);
    setRescheduleOpen(true);
  };

  const handleRescheduleSubmit = async (payload: EventReschedulePayload) => {
    if (!eventToReschedule) return;
    try {
      await updateEvent.mutateAsync({ id: eventToReschedule.id, payload });
      setRescheduleOpen(false);
      setEventToReschedule(null);
    } catch {
      // Error toast surfaced by the hook; keep the dialog open to retry.
    }
  };

  // Canceling opens a confirm dialog (with an optional reason); restoring a
  // canceled event clears both the timestamp and the reason straight away.
  const handleToggleCancel = (eventItem: Event) => {
    if (eventItem.canceled_at) {
      void updateEvent.mutateAsync({
        id: eventItem.id,
        payload: { canceled_at: null, cancel_reason: null },
      });
    } else {
      setEventToCancel(eventItem);
      setCancelDialogOpen(true);
    }
  };

  const handleCancelConfirm = async (reason: string | null) => {
    if (!eventToCancel) return;
    try {
      await updateEvent.mutateAsync({
        id: eventToCancel.id,
        payload: { canceled_at: new Date().toISOString(), cancel_reason: reason },
      });
      setCancelDialogOpen(false);
      setEventToCancel(null);
    } catch {
      // Error toast surfaced by the hook; keep the dialog open to retry.
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
        <AddButton label="Dodaj događaj" onClick={openAdd} />
      </div>

      <div className="mt-4 space-y-3">
        {/* Compact control row in the app's chip idiom: date-range pickers, a
            "Sakrij završene" toggle chip and a reset that appears only while a
            date bound is set. On narrow screens the row scrolls horizontally
            (edge-to-edge via the negative margin) instead of wrapping. */}
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <DatePicker
            id="from"
            value={filterFrom}
            onChange={setFilterFrom}
            placeholder="Od datuma"
            className="w-36 shrink-0"
          />
          <DatePicker
            id="to"
            value={filterTo}
            onChange={setFilterTo}
            placeholder="Do datuma"
            className="w-36 shrink-0"
          />
          <button
            type="button"
            onClick={() => setHideCompleted((prev) => !prev)}
            aria-pressed={hideCompleted}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              hideCompleted
                ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
                : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
            )}
          >
            <EyeSlashIcon
              className={cn(
                "size-4 shrink-0",
                hideCompleted
                  ? "text-blue-500 dark:text-blue-400"
                  : "text-gray-400 dark:text-gray-500",
              )}
            />
            Sakrij završene
          </button>
          {filterFrom || filterTo ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              onClick={clearFilters}
            >
              Resetuj
            </Button>
          ) : null}
        </div>
        <PersonFilterChips selected={selectedPersonIds} onToggle={togglePerson} />
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
            const dim = !!eventItem.canceled_at || isEventEnded(eventItem);
            return (
              <li
                key={eventItem.id}
                className={cn(
                  "rounded-lg border p-4 shadow-sm dark:border-gray-700",
                  dim
                    ? "border-gray-200/80 bg-gray-50 opacity-75 dark:bg-gray-800/80"
                    : "border-gray-200 bg-white dark:bg-gray-800",
                )}
              >
                <EventListItem
                  event={eventItem}
                  personIds={byEvent.get(eventItem.id) ?? []}
                  onEdit={openEdit}
                  onReschedule={openReschedule}
                  onToggleCancel={handleToggleCancel}
                  onDelete={confirmDelete}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      <EventFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        event={editingEvent}
        initialPersonIds={editingPersonIds}
        error={errorMessage}
        saving={createEvent.isPending || updateEvent.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
      />

      <EventRescheduleDialog
        open={rescheduleOpen}
        onOpenChange={(open) => {
          setRescheduleOpen(open);
          if (!open) setEventToReschedule(null);
        }}
        event={eventToReschedule}
        saving={updateEvent.isPending}
        onSubmit={(payload) => {
          void handleRescheduleSubmit(payload);
        }}
      />

      <EventCancelDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          setCancelDialogOpen(open);
          if (!open) setEventToCancel(null);
        }}
        event={eventToCancel}
        saving={updateEvent.isPending}
        onConfirm={(reason) => {
          void handleCancelConfirm(reason);
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
