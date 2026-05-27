import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  ActivityForm,
  type ActivityFormPayload,
} from "@/components/activities/ActivityForm";
import type { Activity, ActivitySchedule, Profile } from "@/types/database";

export type ActivityFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity | null;
  existingRules?: ReadonlyArray<ActivitySchedule>;
  people: ReadonlyArray<Profile>;
  peopleWithShift: ReadonlySet<string>;
  defaultPersonId?: string | null;
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: ActivityFormPayload) => void;
};

/**
 * Same shell pattern as EventFormDialog — error banner above, form below.
 * Mobile renders the form as a bottom-sheet via ResponsiveDialog.
 */
export function ActivityFormDialog({
  open,
  onOpenChange,
  activity,
  existingRules,
  people,
  peopleWithShift,
  defaultPersonId,
  error,
  saving,
  onSubmit,
}: ActivityFormDialogProps) {
  const title = activity ? "Izmeni aktivnost" : "Dodaj aktivnost";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {error ? (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : null}
        <ActivityForm
          activity={activity}
          existingRules={existingRules}
          people={people}
          peopleWithShift={peopleWithShift}
          defaultPersonId={defaultPersonId}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
