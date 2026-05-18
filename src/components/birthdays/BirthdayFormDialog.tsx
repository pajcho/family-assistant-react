import type { Birthday } from "@/types/database";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { BirthdayForm, type BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";

/**
 * Wraps `BirthdayForm` in a `ResponsiveDialog` so the create / edit flow
 * renders as a centered modal on desktop and a bottom sheet (with drag
 * handle) on mobile — the visual pattern locked in by `.nuxt-screens` and
 * MIGRATION_PLAN §1.a.
 *
 * The dialog uses the birthday id as a remount key on the form so switching
 * between "add" and "edit" cleanly resets the controlled inputs even when the
 * dialog stays mounted.
 */
export type BirthdayFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  birthday: Birthday | null;
  /** Optional inline error from the parent (e.g. "Greška pri ažuriranju..."). */
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: BirthdayFormPayload) => void;
};

export function BirthdayFormDialog({
  open,
  onOpenChange,
  birthday,
  error,
  saving = false,
  onSubmit,
}: BirthdayFormDialogProps) {
  const title = birthday ? "Izmeni rođendan" : "Dodaj rođendan";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}
        <BirthdayForm
          // Remount on swap between add (null) and a specific birthday so the
          // controlled state in BirthdayForm is fully reset for the new context.
          key={birthday?.id ?? "new"}
          birthday={birthday}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
