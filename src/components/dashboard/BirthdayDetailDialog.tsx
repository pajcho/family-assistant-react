import { CakeIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { Birthday } from "@/types/database";
import { currentAge } from "@/utils/birthday";
import { formatDate } from "@/utils/date";

/**
 * Per-birthday detail popup — extracted from the old `DashboardBirthdayCard`'s
 * inline dialog so the unified agenda can open it on a birthday row. "Izmeni"
 * routes back to the dashboard's birthday form via `onEdit` (the dialog closes
 * itself first), mirroring the event/payment detail dialogs.
 */
export type BirthdayDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  birthday: Birthday | null;
  onEdit: (birthday: Birthday) => void;
};

export function BirthdayDetailDialog({
  open,
  onOpenChange,
  birthday,
  onEdit,
}: BirthdayDetailDialogProps) {
  const handleEdit = () => {
    if (!birthday) return;
    onOpenChange(false);
    onEdit(birthday);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Detalji rođendana</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {birthday ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
                <CakeIcon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {birthday.name}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Puni godina:</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {currentAge(birthday.birth_date) + 1}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Datum rođenja:</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {formatDate(birthday.birth_date)}
                  </dd>
                </div>
                {birthday.description ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                    <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                      {birthday.description}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        ) : null}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zatvori
          </Button>
          <Button onClick={handleEdit}>Izmeni</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
