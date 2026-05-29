import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { TimetableEditorPanel } from "@/components/activities/TimetableEditorPanel";
import type {
  BellSchedule,
  Profile,
  SchoolShiftAnchor,
  SchoolTimetableEntry,
  TimetableVariant,
} from "@/types/database";
import { getDisplayName } from "@/utils/identity";

export type TimetableEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Profile;
  anchor: SchoolShiftAnchor | undefined;
  /** All family timetable entries — filtered to this member internally. */
  entries: ReadonlyArray<SchoolTimetableEntry>;
  bell: BellSchedule;
  /** Pre-selected shift variant + weekday, from the clicked grid block. */
  initialVariant?: TimetableVariant;
  initialDay?: number;
};

/**
 * Standalone dialog wrapper around the timetable editor — used when a school
 * block on the grid is clicked. The options sheet renders the same panel
 * inline instead. The panel persists on unmount, so closing here saves.
 */
export function TimetableEditor({
  open,
  onOpenChange,
  member,
  anchor,
  entries,
  bell,
  initialVariant,
  initialDay,
}: TimetableEditorProps) {
  const name =
    getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
    "Dete";
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Raspored časova — {name}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <TimetableEditorPanel
          member={member}
          anchor={anchor}
          entries={entries}
          bell={bell}
          initialVariant={initialVariant}
          initialDay={initialDay}
          onDone={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
