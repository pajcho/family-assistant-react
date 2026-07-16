import { useEffect, useState } from "react";
import { CakeIcon, ChevronRightIcon, SparklesIcon, TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  SheetActionList,
  SheetActionsKebab,
  type SheetAction,
} from "@/components/common/SheetActions";
import type { Birthday, Event } from "@/types/database";
import { currentAge, daysUntilBirthday } from "@/utils/birthday";
import { formatDate } from "@/utils/date";

/**
 * Detail popup for one birthday — the payments-sheet pattern: hero, state as
 * badges ("za N dana", next age), info rows, footer with "Izmeni" and
 * "Organizuj proslavu" as the contextual primary (until a celebration
 * exists), delete behind the kebab (mobile: "Opcije" sub-view). Heavier flows
 * (edit form, delete confirm, celebration form) live in the page's dialogs —
 * this sheet closes and delegates.
 */
export type BirthdayDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  birthday: Birthday | null;
  /** Soonest upcoming celebration event linked to this birthday, if any. */
  celebration?: Event | null;
  onEdit: (birthday: Birthday) => void;
  onDelete: (birthday: Birthday) => void;
  onOrganize: (birthday: Birthday) => void;
  onOpenCelebration: (event: Event) => void;
};

type Mode = "detail" | "actions";

/** "Puni 9 godina / 21 godinu / 3 godine" — Serbian count agreement. */
function ageLabel(age: number): string {
  const mod10 = age % 10;
  const mod100 = age % 100;
  if (mod10 === 1 && mod100 !== 11) return `Puni ${age} godinu`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `Puni ${age} godine`;
  return `Puni ${age} godina`;
}

function daysLabel(days: number): string {
  if (days === 0) return "Danas 🎉";
  if (days === 1) return "Sutra";
  return `za ${days} dana`;
}

export function BirthdayDetailDialog({
  open,
  onOpenChange,
  birthday,
  celebration = null,
  onEdit,
  onDelete,
  onOrganize,
  onOpenCelebration,
}: BirthdayDetailDialogProps) {
  const [mode, setMode] = useState<Mode>("detail");

  useEffect(() => {
    if (!open) setMode("detail");
  }, [open]);
  useEffect(() => {
    setMode("detail");
  }, [birthday]);

  // Close first, then hand off to the page's own dialog for the flow.
  const delegate = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const actionItems: SheetAction[] = birthday
    ? [
        {
          key: "delete",
          label: "Obriši rođendan",
          icon: TrashIcon,
          destructive: true,
          onSelect: () => delegate(() => onDelete(birthday)),
        },
      ]
    : [];

  const days = birthday ? daysUntilBirthday(birthday.birth_date) : 0;
  const nextAge = birthday ? currentAge(birthday.birth_date) + 1 : 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader className={mode === "detail" ? "sr-only" : undefined}>
          <ResponsiveDialogTitle>
            {mode === "actions" ? "Opcije" : "Detalji rođendana"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {birthday ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-900/50">
                <CakeIcon className="h-6 w-6 text-pink-600 dark:text-pink-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {birthday.name}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Rođendan · {formatDate(birthday.birth_date)}
                </p>
              </div>
              {mode === "detail" ? (
                <SheetActionsKebab items={actionItems} onOpenActions={() => setMode("actions")} />
              ) : null}
            </div>

            {mode === "actions" ? (
              <SheetActionList items={actionItems} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      days <= 1
                        ? "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {daysLabel(days)}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {ageLabel(nextAge)}
                  </span>
                </div>

                <div className="divide-y divide-gray-100 border-t border-gray-100 text-sm dark:divide-gray-700/60 dark:border-gray-700/60">
                  {birthday.description ? (
                    <div className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">Opis</span>
                      <span className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {birthday.description}
                      </span>
                    </div>
                  ) : null}
                  {celebration ? (
                    <button
                      type="button"
                      onClick={() => delegate(() => onOpenCelebration(celebration))}
                      className="flex w-full items-center gap-2 py-2.5 text-sm font-medium text-gray-900 transition-colors hover:text-pink-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:text-gray-100 dark:hover:text-pink-400"
                    >
                      <SparklesIcon className="size-4 text-pink-500 dark:text-pink-400" />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {celebration.name} · {formatDate(celebration.date)}
                      </span>
                      <ChevronRightIcon className="ml-auto size-4 shrink-0 text-gray-400 dark:text-gray-500" />
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {mode === "actions" ? (
          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setMode("detail")}
            >
              Nazad
            </Button>
          </ResponsiveDialogFooter>
        ) : (
          <ResponsiveDialogFooter className="flex-row items-center gap-2 sm:justify-end">
            {birthday && !celebration ? (
              <>
                <Button
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => delegate(() => onEdit(birthday))}
                >
                  Izmeni
                </Button>
                {/* Contextual primary: the one thing a family does with an
                    upcoming birthday that has no plan yet. */}
                <Button
                  className="flex-[1.4] sm:flex-none"
                  onClick={() => delegate(() => onOrganize(birthday))}
                >
                  <CakeIcon className="size-4" />
                  Organizuj proslavu
                </Button>
              </>
            ) : birthday ? (
              <Button
                className="flex-1 sm:flex-none"
                onClick={() => delegate(() => onEdit(birthday))}
              >
                Izmeni
              </Button>
            ) : null}
          </ResponsiveDialogFooter>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
