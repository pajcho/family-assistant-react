import { useMemo, useState } from "react";
import { CakeIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { BirthdayDisplayLine } from "@/components/birthdays/BirthdayDisplayLine";
import type { Birthday } from "@/types/database";
import { currentAge, daysUntilBirthday, nextBirthdayDate } from "@/utils/birthday";
import { formatDate } from "@/utils/date";

/**
 * "Sledeći rođendani" dashboard card. Direct port of
 * `components/dashboard/DashboardBirthdayCard.vue`.
 *
 * Shows the next 3 upcoming birthdays. Same-day overflow: if more than 3
 * birthdays fall within the upcoming window, take the first 3 PLUS any
 * additional birthdays whose next occurrence shares the same calendar day
 * as the third entry. Mirrors the Vue `displayBirthdays` computed line-for-
 * line so two siblings sharing a date never get hidden behind the cutoff.
 *
 * Each row uses a custom green-tinted button (rather than `DashboardCardItem`)
 * so the `BirthdayDisplayLine` component can render its stacked-name+meta
 * layout — same pattern as the Vue source.
 */
export type DashboardBirthdayCardProps = {
  birthdays: Birthday[];
  onAdd: () => void;
  onEdit: (birthday: Birthday) => void;
};

function daysLabel(birthDate: string): string {
  const days = daysUntilBirthday(birthDate);
  if (days === 0) return "danas";
  if (days === 1) return "sutra";
  return `za ${days} dana`;
}

export function DashboardBirthdayCard({ birthdays, onAdd, onEdit }: DashboardBirthdayCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedBirthday, setSelectedBirthday] = useState<Birthday | null>(null);

  const allSorted = useMemo<Birthday[]>(() => {
    return birthdays
      .slice()
      .toSorted((a, b) => daysUntilBirthday(a.birth_date) - daysUntilBirthday(b.birth_date));
  }, [birthdays]);

  // First 3 upcoming, plus any extras that share the third entry's next date.
  const displayBirthdays = useMemo<Birthday[]>(() => {
    if (allSorted.length === 0) return [];
    if (allSorted.length <= 3) return allSorted;
    const third = allSorted[2];
    if (!third) return allSorted;
    const thirdNextDate = nextBirthdayDate(third.birth_date).getTime();
    return allSorted.filter((b) => nextBirthdayDate(b.birth_date).getTime() <= thirdNextDate);
  }, [allSorted]);

  const openDetail = (birthday: Birthday) => {
    setSelectedBirthday(birthday);
    setDetailOpen(true);
  };

  const handleEdit = () => {
    if (!selectedBirthday) return;
    setDetailOpen(false);
    onEdit(selectedBirthday);
  };

  return (
    <>
      <DashboardCard
        icon={CakeIcon}
        title="Sledeći rođendani"
        emptyMessage="Nema nadolazećih rođendana"
        addLabel="Dodaj rođendan"
        viewAllLink="/birthdays"
        hasItems={displayBirthdays.length > 0}
        accent="emerald"
        onAdd={onAdd}
      >
        {displayBirthdays.map((birthday) => (
          <button
            key={birthday.id}
            type="button"
            onClick={() => openDetail(birthday)}
            className="flex w-full items-start justify-between gap-2 rounded-md bg-emerald-50 px-3 py-2 text-left text-sm transition-colors hover:bg-emerald-100 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/30"
          >
            <span className="min-w-0 flex-1">
              <BirthdayDisplayLine name={birthday.name} birthDate={birthday.birth_date} hideDays />
            </span>
            <span className="shrink-0 text-emerald-700 dark:text-emerald-400">
              {daysLabel(birthday.birth_date)}
            </span>
          </button>
        ))}
      </DashboardCard>

      <ResponsiveDialog open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Detalji rođendana</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {selectedBirthday ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
                  <CakeIcon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selectedBirthday.name}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Puni godina:</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {currentAge(selectedBirthday.birth_date) + 1}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Datum rođenja:</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {formatDate(selectedBirthday.birth_date)}
                    </dd>
                  </div>
                  {selectedBirthday.description ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {selectedBirthday.description}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          ) : null}
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Zatvori
            </Button>
            <Button onClick={handleEdit}>Izmeni</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
