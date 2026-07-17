import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EyeIcon, PlusIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { AddButton } from "@/components/common/AddButton";
import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { FilterBar } from "@/components/common/FilterBar";
import {
  AppliedFilterChips,
  FilterSection,
  FilterSheet,
  FilterSwitchRow,
  useMemberAppliedFilters,
} from "@/components/common/FilterSheet";
import { ALL_MONTHS, MonthPicker } from "@/components/common/PeriodPicker";
import { PersonFilterChips } from "@/components/common/PersonFilterChips";
import { EventDetailDialog } from "@/components/events/EventDetailDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { EventTimelineRow } from "@/components/events/EventTimelineRow";
import type { EventFormPayload } from "@/components/events/EventForm";
import { useCreateEvent, useEventsList, useUpdateEvent } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { useToday } from "@/hooks/useToday";
import type { Event } from "@/types/database";
import { addDays } from "@/utils/date";
import { isEventEnded } from "@/utils/event";

export const Route = createFileRoute("/_app/events")({
  component: EventsPage,
});

/** Minimum characters before the client-side search kicks in. */
const MIN_SEARCH_CHARS = 2;

function EventsPage() {
  // Filters — the same control set as /payments: a month picker (default
  // "Svi događaji" = no bound, with the "Ovaj mesec" shortcut visible), a
  // text search, person chips and a "Sakrij završene" toggle chip. The list
  // is fetched unbounded and filtered client-side.
  const [selectedMonth, setSelectedMonth] = useState<string>(ALL_MONTHS);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const searchActive = searchTerm.trim().length >= MIN_SEARCH_CHARS;
  // Person filter — same convention as the dashboard's person facet: an empty
  // set means "no filter"; a non-empty set narrows to those members.
  const [selectedPersonIds, setSelectedPersonIds] = useState<ReadonlySet<string>>(() => new Set());

  // Detail popup — a row tap opens it; every action lives inside.
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  // Dialog state — reschedule / cancel / delete žive kao sub-view-ovi UNUTAR
  // detail popupa (sheet stack); stranica drži samo formu za dodavanje/izmenu.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eventsQuery = useEventsList();
  const { byEvent } = useEventParticipants();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();

  const events = useMemo<Event[]>(() => eventsQuery.data ?? [], [eventsQuery.data]);
  // Month + "Sakrij završene" + the person facet. Person semantics mirror the
  // dashboard's `matchesAgendaFilter`: empty selection shows everything; with
  // members selected only events assigned to at least one of them pass
  // (unassigned events hide while the filter is active).
  //
  // Search mode (≥ MIN_SEARCH_CHARS) matches name/description/notes and
  // ignores the month + completed filters — they'd hide exactly what the
  // user is looking for. The person facet still applies.
  const filteredEvents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return events.filter((e) => {
      if (selectedPersonIds.size > 0) {
        const personIds = byEvent.get(e.id) ?? [];
        if (!personIds.some((id) => selectedPersonIds.has(id))) return false;
      }
      if (searchActive) {
        return (
          e.name.toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q) ||
          (e.notes ?? "").toLowerCase().includes(q)
        );
      }
      if (selectedMonth !== ALL_MONTHS && !e.date.startsWith(selectedMonth)) return false;
      if (hideCompleted && isEventEnded(e)) return false;
      return true;
    });
  }, [events, searchActive, searchTerm, selectedMonth, hideCompleted, selectedPersonIds, byEvent]);
  const editingPersonIds = editingEvent ? (byEvent.get(editingEvent.id) ?? []) : [];

  const togglePerson = (personId: string) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  // Timeline grouping — same as /payments: sections per day under the shared
  // AgendaDateHeader. Search mode stays flat (results span every month).
  const { str: today, date: todayDate } = useToday();
  const tomorrow = useMemo(() => format(addDays(todayDate, 1), "yyyy-MM-dd"), [todayDate]);
  const eventGroups = useMemo(() => {
    const byDay = new Map<string, Event[]>();
    for (const e of filteredEvents) {
      const bucket = byDay.get(e.date);
      if (bucket) bucket.push(e);
      else byDay.set(e.date, [e]);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEvents]);

  // How many completed events the default view hides — the quiet reveal link.
  const hiddenCompletedCount = useMemo(() => {
    if (searchActive || !hideCompleted) return 0;
    return events.filter((e) => {
      if (selectedPersonIds.size > 0) {
        const personIds = byEvent.get(e.id) ?? [];
        if (!personIds.some((id) => selectedPersonIds.has(id))) return false;
      }
      if (selectedMonth !== ALL_MONTHS && !e.date.startsWith(selectedMonth)) return false;
      return isEventEnded(e);
    }).length;
  }, [events, searchActive, hideCompleted, selectedMonth, selectedPersonIds, byEvent]);

  // Filter plumbing for the shared sheet + applied-chips row.
  const showCompleted = !hideCompleted;
  const filterCount = selectedPersonIds.size + (showCompleted ? 1 : 0);
  const resetFilters = () => {
    setSelectedPersonIds(new Set());
    setHideCompleted(true);
  };
  const memberApplied = useMemberAppliedFilters(selectedPersonIds, togglePerson);
  const appliedFilters = useMemo(
    () =>
      showCompleted
        ? [
            ...memberApplied,
            {
              key: "__show-completed__",
              label: "Završeni prikazani",
              onRemove: () => setHideCompleted(true),
            },
          ]
        : memberApplied,
    [memberApplied, showCompleted],
  );

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

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingEvent(null);
      setErrorMessage(null);
    }
  };

  const isLoading = eventsQuery.isLoading;
  const showEmpty = !isLoading && filteredEvents.length === 0;

  return (
    <div className="animate-fade-in pb-24 lg:pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Događaji</h1>
        <AddButton label="Dodaj događaj" onClick={openAdd} />
      </div>

      <div className="mt-4 space-y-3">
        <FilterBar
          picker={
            <MonthPicker
              value={selectedMonth}
              onChange={setSelectedMonth}
              allOptionLabel="Svi događaji"
            />
          }
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Pretraži događaje…"
          filterCount={filterCount}
          onOpenFilters={() => setFiltersOpen(true)}
        />
        <AppliedFilterChips filters={appliedFilters} onClearAll={resetFilters} />
      </div>

      {searchActive ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Rezultati pretrage obuhvataju sve mesece (filteri meseca i završenih se ne primenjuju).
        </p>
      ) : null}

      {isLoading ? <div className="mt-6 text-gray-500">Učitavanje…</div> : null}

      {showEmpty ? (
        events.length === 0 ? (
          <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800">
            <p className="text-gray-500 dark:text-gray-400">Nema događaja za prikaz.</p>
            <Button onClick={openAdd} className="mt-4">
              <PlusIcon className="mr-2 h-5 w-5" />
              Dodaj događaj
            </Button>
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            {searchActive
              ? "Nema događaja koji odgovaraju pretrazi."
              : "Nema događaja za izabrane filtere."}
          </div>
        )
      ) : null}

      {!isLoading && filteredEvents.length > 0 ? (
        searchActive ? (
          <ul className="mt-6 space-y-1">
            {filteredEvents.map((eventItem) => (
              <li key={eventItem.id}>
                <EventTimelineRow
                  event={eventItem}
                  personIds={byEvent.get(eventItem.id) ?? []}
                  showDate
                  onSelect={setSelectedEvent}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 space-y-6">
            {eventGroups.map(([day, dayEvents]) => (
              <section key={day}>
                <AgendaDateHeader day={day} today={today} tomorrow={tomorrow} />
                <ul className="mt-2 space-y-1">
                  {dayEvents.map((eventItem) => (
                    <li key={eventItem.id}>
                      <EventTimelineRow
                        event={eventItem}
                        personIds={byEvent.get(eventItem.id) ?? []}
                        onSelect={setSelectedEvent}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : null}

      {/* Quiet reveal for the default hide-completed view. */}
      {hiddenCompletedCount > 0 ? (
        <div className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Sakriveno {hiddenCompletedCount} {hiddenCompletedCount === 1 ? "završen" : "završenih"} ·{" "}
          <button
            type="button"
            onClick={() => setHideCompleted(false)}
            className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
          >
            Prikaži
          </button>
        </div>
      ) : null}

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        isActive={filterCount > 0}
        onReset={resetFilters}
      >
        <FilterSection title="Članovi">
          <PersonFilterChips selected={selectedPersonIds} onToggle={togglePerson} />
        </FilterSection>
        <section className="space-y-1">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Prikaz
          </h4>
          <FilterSwitchRow
            label="Prikaži i završene"
            icon={EyeIcon}
            checked={showCompleted}
            onCheckedChange={(checked) => setHideCompleted(!checked)}
          />
        </section>
      </FilterSheet>

      <EventDetailDialog
        open={!!selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
        event={selectedEvent}
        personIds={selectedEvent ? (byEvent.get(selectedEvent.id) ?? []) : []}
        onEdit={openEdit}
      />

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
    </div>
  );
}
