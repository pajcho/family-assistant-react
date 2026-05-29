import * as React from "react";
import {
  AcademicCapIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  Cog6ToothIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { ShiftSetupForm } from "@/components/activities/ShiftSetupForm";
import { TimetableEditorPanel } from "@/components/activities/TimetableEditorPanel";
import { BellSchedulePanel } from "@/components/activities/BellSchedulePanel";
import { FamilyMembersPanel } from "@/components/activities/FamilyMembersPanel";
import type {
  BellSchedule,
  Profile,
  SchoolShift,
  SchoolShiftAnchor,
  SchoolTimetableEntry,
} from "@/types/database";
import { SHIFT_LABELS, fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";

export type ActivityOptionsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: ReadonlyArray<Profile>;
  anchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  /** Resolved time band per child for the displayed week (label only). */
  timeBandByPerson: ReadonlyMap<string, SchoolShift>;
  entries: ReadonlyArray<SchoolTimetableEntry>;
  bell: BellSchedule;
};

type View =
  | { kind: "hub" }
  | { kind: "shift"; personId: string }
  | { kind: "timetable"; personId: string }
  | { kind: "bell" }
  | { kind: "family" };

function memberName(member: Profile | undefined): string {
  if (!member) return "Dete";
  return (
    getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
    "Dete"
  );
}

/**
 * The "Opcije" hub — a bottom sheet (drawer on mobile) that collects the
 * page's secondary controls. Instead of closing on every action, it navigates
 * in place: clicking an option swaps the sheet's content to that editor with a
 * "← Nazad" header that returns to the hub. One overlay, no stacking.
 */
export function ActivityOptionsSheet({
  open,
  onOpenChange,
  members,
  anchorsByPersonId,
  timeBandByPerson,
  entries,
  bell,
}: ActivityOptionsSheetProps) {
  const [view, setView] = React.useState<View>({ kind: "hub" });

  // Always start at the hub the next time it opens.
  React.useEffect(() => {
    if (!open) setView({ kind: "hub" });
  }, [open]);

  const memberById = React.useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const back = () => setView({ kind: "hub" });

  // A sub-view that needs a member but can't find one (e.g. deleted) falls
  // back to the hub defensively.
  const focusedMember =
    view.kind === "shift" || view.kind === "timetable" ? memberById.get(view.personId) : undefined;
  const effectiveView: View =
    (view.kind === "shift" || view.kind === "timetable") && !focusedMember ? { kind: "hub" } : view;

  const title =
    effectiveView.kind === "hub"
      ? "Opcije"
      : effectiveView.kind === "shift"
        ? `Smena — ${memberName(focusedMember)}`
        : effectiveView.kind === "timetable"
          ? `Raspored — ${memberName(focusedMember)}`
          : effectiveView.kind === "bell"
            ? "Satnica zvona"
            : "Porodica";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-1.5">
            {effectiveView.kind !== "hub" ? (
              <button
                type="button"
                onClick={back}
                aria-label="Nazad na opcije"
                className="-ml-1.5 rounded-md p-1 text-muted-foreground hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
            ) : null}
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </div>
        </ResponsiveDialogHeader>

        {effectiveView.kind === "hub" ? (
          <Hub
            members={members}
            anchorsByPersonId={anchorsByPersonId}
            timeBandByPerson={timeBandByPerson}
            onPick={setView}
          />
        ) : null}

        {effectiveView.kind === "shift" && focusedMember ? (
          <ShiftSetupForm
            member={focusedMember}
            anchor={anchorsByPersonId.get(focusedMember.id)}
            onClose={back}
          />
        ) : null}

        {effectiveView.kind === "timetable" && focusedMember ? (
          <TimetableEditorPanel
            member={focusedMember}
            anchor={anchorsByPersonId.get(focusedMember.id)}
            entries={entries}
            bell={bell}
            onDone={back}
          />
        ) : null}

        {effectiveView.kind === "bell" ? <BellSchedulePanel bell={bell} onClose={back} /> : null}

        {effectiveView.kind === "family" ? <FamilyMembersPanel members={members} /> : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function Hub({
  members,
  anchorsByPersonId,
  timeBandByPerson,
  onPick,
}: {
  members: ReadonlyArray<Profile>;
  anchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  timeBandByPerson: ReadonlyMap<string, SchoolShift>;
  onPick: (view: View) => void;
}) {
  return (
    <div className="space-y-4">
      {members.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Škola po detetu
          </h3>
          <ul className="space-y-2">
            {members.map((member) => {
              const color = member.color ?? fallbackColorForProfile(member.id);
              const name = memberName(member);
              const hasAnchor = anchorsByPersonId.has(member.id);
              const band = timeBandByPerson.get(member.id) ?? null;
              return (
                <li
                  key={member.id}
                  className="space-y-2 rounded-md border border-gray-200 p-2.5 dark:border-gray-700"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {band ? SHIFT_LABELS[band] : hasAnchor ? "Smena postavljena" : "Bez smene"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => onPick({ kind: "shift", personId: member.id })}
                    >
                      <AcademicCapIcon className="mr-1.5 h-4 w-4" />
                      Smena
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => onPick({ kind: "timetable", personId: member.id })}
                    >
                      <BookOpenIcon className="mr-1.5 h-4 w-4" />
                      Raspored
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Podešavanja
        </h3>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={() => onPick({ kind: "bell" })}
        >
          <Cog6ToothIcon className="mr-2 h-4 w-4" />
          Satnica zvona
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={() => onPick({ kind: "family" })}
        >
          <UserGroupIcon className="mr-2 h-4 w-4" />
          Porodica i boje
        </Button>
      </section>
    </div>
  );
}
