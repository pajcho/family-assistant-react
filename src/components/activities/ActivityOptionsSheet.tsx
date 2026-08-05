import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AcademicCapIcon,
  BookOpenIcon,
  Cog6ToothIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { Button } from "@/components/ui/button";
import { ShiftSetupForm } from "@/components/activities/ShiftSetupForm";
import { TimetableEditorPanel } from "@/components/activities/TimetableEditorPanel";
import { BellSchedulePanel } from "@/components/activities/BellSchedulePanel";
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
  | { kind: "bell" };

function memberName(member: Profile | undefined): string {
  if (!member) return "Dete";
  return (
    getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
    "Dete"
  );
}

/**
 * The "Opcije" hub - a bottom sheet (drawer on mobile) that collects the
 * page's secondary controls. Instead of closing on every action, it drills in
 * (sheet stack): clicking an option opens that editor as a sheet ON TOP of the
 * hub with a "← Nazad" header, and dismissing the editor (swipe / tap outside)
 * lands back on the hub, which never went anywhere.
 *
 * Member management (add / remove / colors / logins) lives on the Porodica
 * settings tab - the "Porodica i članovi" button just redirects there.
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
  const navigate = useNavigate();
  const stack = useSheetStack<View>(open, onOpenChange, { kind: "hub" });
  const { view, push, pop, reset } = stack;

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const back = pop;

  // A sub-view that needs a member but can't find one (e.g. deleted) falls
  // back to the hub defensively.
  const memberFor = (v: View) =>
    v.kind === "shift" || v.kind === "timetable" ? memberById.get(v.personId) : undefined;
  const focusedMemberMissing =
    (view.kind === "shift" || view.kind === "timetable") && !memberFor(view);

  // A member can disappear through another session while their editor is
  // open. Render the hub immediately, then discard the invalid stack entry so
  // the next navigation does not push on top of a view that can never render.
  useEffect(() => {
    if (focusedMemberMissing) reset();
  }, [focusedMemberMissing, reset]);

  const titleFor = (v: View, member: Profile | undefined) =>
    v.kind === "hub"
      ? "Opcije"
      : v.kind === "shift"
        ? `Smena - ${memberName(member)}`
        : v.kind === "timetable"
          ? `Raspored - ${memberName(member)}`
          : "Satnica zvona";

  return (
    <SheetStackViews
      stack={stack}
      render={(rawView, level) => {
        const focusedMember = memberFor(rawView);
        const missing =
          (rawView.kind === "shift" || rawView.kind === "timetable") && !focusedMember;
        const effectiveView: View = missing ? { kind: "hub" } : rawView;
        return (
          <ResponsiveDialogContent className="sm:max-w-md">
            <SheetStackHeader
              title={titleFor(effectiveView, focusedMember)}
              onBack={effectiveView.kind !== "hub" && level > 0 ? back : undefined}
              backAriaLabel="Nazad na opcije"
            />

            {effectiveView.kind === "hub" ? (
              <Hub
                members={members}
                anchorsByPersonId={anchorsByPersonId}
                timeBandByPerson={timeBandByPerson}
                onPick={push}
                onManageFamily={() => {
                  onOpenChange(false);
                  void navigate({ to: "/settings", search: { tab: "family" } });
                }}
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

            {effectiveView.kind === "bell" ? (
              <BellSchedulePanel bell={bell} onClose={back} />
            ) : null}
          </ResponsiveDialogContent>
        );
      }}
    />
  );
}

function Hub({
  members,
  anchorsByPersonId,
  timeBandByPerson,
  onPick,
  onManageFamily,
}: {
  members: ReadonlyArray<Profile>;
  anchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  timeBandByPerson: ReadonlyMap<string, SchoolShift>;
  onPick: (view: View) => void;
  onManageFamily: () => void;
}) {
  // Only students (those with a shift anchor) get school controls here. A
  // member becomes a student via the "Učenik" toggle in Podešavanja → Porodica.
  const students = useMemo(
    () => members.filter((member) => anchorsByPersonId.has(member.id)),
    [members, anchorsByPersonId],
  );

  return (
    <div className="space-y-4">
      {students.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
            Škola po detetu
          </h3>
          <ul className="space-y-2">
            {students.map((member) => {
              const color = member.color ?? fallbackColorForProfile(member.id);
              const name = memberName(member);
              const band = timeBandByPerson.get(member.id) ?? null;
              return (
                <li key={member.id} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate text-sm font-semibold text-foreground">
                      {name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {band ? SHIFT_LABELS[band] : "Smena postavljena"}
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
        <h3 className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
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
          onClick={onManageFamily}
        >
          <UserGroupIcon className="mr-2 h-4 w-4" />
          Porodica i članovi
        </Button>
      </section>
    </div>
  );
}
