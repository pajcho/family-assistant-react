import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { CakeIcon, EyeIcon, PlusIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";
import type { Birthday } from "@/types/database";
import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { FilterBar } from "@/components/common/FilterBar";
import { AppliedFilterChips, FilterSheet, FilterSwitchRow } from "@/components/common/FilterSheet";
import { ALL_MONTHS, MonthPicker } from "@/components/common/PeriodPicker";
import { BirthdayDetailDialog } from "@/components/birthdays/BirthdayDetailDialog";
import { BirthdayTimelineRow } from "@/components/birthdays/BirthdayTimelineRow";
import {
  BirthdayFormDialog,
  type BirthdayFormDialogProps,
} from "@/components/birthdays/BirthdayFormDialog";
import { type BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import { useBirthdaysList, useCreateBirthday, useUpdateBirthday } from "@/hooks/useBirthdays";
import { useBirthdayCelebrations } from "@/hooks/useEvents";
import { daysUntilBirthday, nextBirthdayDate } from "@/utils/birthday";
import { srLocale } from "@/utils/date";

/**
 * `/birthdays` - list + CRUD for the family's birthdays.
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

/** Capitalized Serbian month name for a "MM" key (e.g. "07" → "Jul"). */
function monthLabel(mm: string): string {
  const label = format(new Date(2020, Number(mm) - 1, 1), "LLLL", { locale: srLocale });
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function BirthdaysPage() {
  const { data: birthdays, isLoading } = useBirthdaysList();
  const createMutation = useCreateBirthday();
  const updateMutation = useUpdateBirthday();

  // Filters - the shared control set: a month picker CLAMPED to the current
  // year (birthdays repeat annually, so "Avg" means "this year's August"),
  // defaulting to "Svi rođendani"; a text search; and a "Sakrij prošle
  // rođendane" toggle - ON by default, so the list opens with only the
  // upcoming ones.
  const currentYear = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState<string>(ALL_MONTHS);
  const [searchTerm, setSearchTerm] = useState("");
  const [hidePassed, setHidePassed] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchActive = searchTerm.trim().length >= MIN_SEARCH_CHARS;

  // Detail popup - a row tap opens it; every action lives inside.
  const [selectedBirthday, setSelectedBirthday] = useState<Birthday | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState<Birthday | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Celebrations only feed the row chips here - organizing / editing one
  // lives inside BirthdayDetailDialog (self-contained since the redesign).
  const { data: celebrationByBirthday } = useBirthdayCelebrations();

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

  // Timeline grouping: by month (birthdays recur annually), ordered from the
  // current month onward so what's coming up leads; within a month, by day.
  const birthdayGroups = useMemo(() => {
    const byMonth = new Map<string, Birthday[]>();
    for (const b of filteredBirthdays) {
      const mm = b.birth_date.slice(5, 7);
      const bucket = byMonth.get(mm);
      if (bucket) bucket.push(b);
      else byMonth.set(mm, [b]);
    }
    const curMonth = new Date().getMonth() + 1;
    const rank = (mm: string) => (Number(mm) - curMonth + 12) % 12;
    const groups = [...byMonth.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
    for (const [, list] of groups) {
      list.sort((a, b) => a.birth_date.slice(8, 10).localeCompare(b.birth_date.slice(8, 10)));
    }
    return groups;
  }, [filteredBirthdays]);

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

  const saving = createMutation.isPending || updateMutation.isPending;

  const header = (
    <div className="flex flex-col gap-2.5">
      <ScreenHeaderRow
        title="Rođendani"
        actions={
          <>
            <IconButton icon={PlusIcon} aria-label="Dodaj rođendan" onClick={openAdd} />
          </>
        }
      />
      <FilterBar
        picker={
          <MonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            allOptionLabel="Svi rođendani"
            minMonth={`${currentYear}-01`}
            maxMonth={`${currentYear}-12`}
          />
        }
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Pretraži rođendane…"
        filterCount={hidePassed ? 0 : 1}
        onOpenFilters={() => setFiltersOpen(true)}
      />
      <AppliedFilterChips
        filters={
          hidePassed
            ? []
            : [
                {
                  key: "__show-passed__",
                  label: "Prošli prikazani",
                  onRemove: () => setHidePassed(true),
                },
              ]
        }
        onClearAll={() => setHidePassed(true)}
      />
    </div>
  );

  return (
    <AppScreen header={header}>
      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        isActive={!hidePassed}
        onReset={() => setHidePassed(true)}
      >
        <section className="space-y-1">
          <h4 className="text-xs font-normal tracking-wide text-muted-foreground uppercase">
            Prikaz
          </h4>
          <FilterSwitchRow
            label="Prikaži i prošle rođendane"
            icon={EyeIcon}
            checked={!hidePassed}
            onCheckedChange={(checked) => setHidePassed(!checked)}
          />
        </section>
      </FilterSheet>

      {isLoading ? (
        <AgendaListSkeleton rows={4} />
      ) : (birthdays ?? []).length === 0 ? (
        <EmptyState
          icon={CakeIcon}
          tone="emerald"
          title="Nijedan rođendan te više neće iznenaditi"
          description="Upiši datume jednom - godišnjice se računaju same, uz podsetnik na vreme."
          action={{ label: "Dodaj rođendan", onClick: openAdd }}
        />
      ) : filteredBirthdays.length === 0 ? (
        <EmptyState
          variant="filter"
          description={
            searchActive
              ? "Nema rođendana koji odgovaraju pretrazi."
              : "Nema rođendana za izabrane filtere."
          }
          secondaryAction={{
            label: searchActive ? "Obriši pretragu" : "Prikaži sve",
            onClick: searchActive
              ? () => setSearchTerm("")
              : () => {
                  setSelectedMonth(ALL_MONTHS);
                  setHidePassed(false);
                },
          }}
        />
      ) : (
        <div className="space-y-4">
          {birthdayGroups.map(([month, list]) => (
            <section key={month}>
              <SectionHeading count={list.length} className="mb-2">
                {monthLabel(month)}
              </SectionHeading>
              <ul className="space-y-2.5">
                {list.map((b) => (
                  <li key={b.id}>
                    <BirthdayTimelineRow
                      birthday={b}
                      celebration={celebrationByBirthday?.get(b.id) ?? null}
                      onSelect={setSelectedBirthday}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <BirthdayDetailDialog
        open={!!selectedBirthday}
        onOpenChange={(open) => {
          if (!open) setSelectedBirthday(null);
        }}
        birthday={selectedBirthday}
        onEdit={openEdit}
      />

      <BirthdayFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        birthday={editingBirthday}
        error={formError}
        saving={saving}
        onSubmit={handleSubmit}
      />
    </AppScreen>
  );
}
