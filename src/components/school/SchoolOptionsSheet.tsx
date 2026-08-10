import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AcademicCapIcon,
  BellIcon,
  BookOpenIcon,
  SunIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { Button } from "@/components/ui/button";
import { SettingsGroup, SettingsRow } from "@/components/settings/SettingsChrome";
import { ShiftSetupForm } from "@/components/school/ShiftSetupForm";
import { TimetableEditorPanel } from "@/components/school/TimetableEditorPanel";
import { BellSchedulePanel } from "@/components/school/BellSchedulePanel";
import { SchoolBreakForm } from "@/components/school/SchoolBreakForm";
import { SchoolBreaksPanel } from "@/components/school/SchoolBreaksPanel";
import { useSchoolBreaks } from "@/hooks/useSchoolBreaks";
import type {
  BellSchedule,
  Profile,
  SchoolShift,
  SchoolShiftAnchor,
  SchoolTimetableEntry,
  TimetableVariant,
} from "@/types/database";
import { SHIFT_LABELS, fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { serbianPlural } from "@/utils/plural";

export type SchoolOptionsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: ReadonlyArray<Profile>;
  anchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  /** Resolved time band per child for the displayed week (label only). */
  timeBandByPerson: ReadonlyMap<string, SchoolShift>;
  entries: ReadonlyArray<SchoolTimetableEntry>;
  bell: BellSchedule;
  /** Optional entry point - opens straight into a sub-view instead of the hub. */
  initialView?: SchoolOptionsView | null;
};

export type SchoolOptionsView =
  | { kind: "hub" }
  | { kind: "shift"; personId: string }
  /** `variant`/`day` pre-select a column when opened from a specific cell. */
  | { kind: "timetable"; personId: string; variant?: TimetableVariant; day?: number }
  | { kind: "bell" }
  | { kind: "breaks" }
  /** `breakId: null` adds a new one. */
  | { kind: "breakForm"; breakId: string | null };

type View = SchoolOptionsView;

function memberName(member: Profile | undefined): string {
  if (!member) return "Dete";
  return (
    getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
    "Dete"
  );
}

/**
 * The options hub of the school screen - everything that CONFIGURES school,
 * as opposed to the page itself, which only shows the result.
 *
 * Instead of closing on every action it drills in (sheet stack): picking an
 * option opens that editor as a sheet ON TOP of the hub with a "← Nazad"
 * header, and dismissing the editor lands back on the hub, which never went
 * anywhere. `initialView` lets the page skip the hub entirely - the pencil on
 * the shift card opens "Smena" directly, with no hub underneath to go back to.
 *
 * Member management (add / remove / colors / logins) and the student toggle
 * that makes someone a student in the first place live on the Porodica
 * settings tab - the family-and-members row just redirects there.
 */
export function SchoolOptionsSheet({
  open,
  onOpenChange,
  members,
  anchorsByPersonId,
  timeBandByPerson,
  entries,
  bell,
  initialView = null,
}: SchoolOptionsSheetProps) {
  const navigate = useNavigate();
  const stack = useSheetStack<View>(open, onOpenChange, initialView ?? { kind: "hub" });
  const { view, push, pop, reset } = stack;
  const { breaks, memberIdsByBreak } = useSchoolBreaks();

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const back = pop;

  // A raspust can only name children who actually have a timetable - being a
  // student here means having a shift anchor, same rule as the Hub below.
  const students = useMemo(
    () => members.filter((member) => anchorsByPersonId.has(member.id)),
    [members, anchorsByPersonId],
  );

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

  const titleFor = (v: View, member: Profile | undefined) => {
    switch (v.kind) {
      case "hub":
        return "Opcije";
      case "shift":
        return `Smena - ${memberName(member)}`;
      case "timetable":
        return `Raspored - ${memberName(member)}`;
      case "bell":
        return "Satnica zvona";
      case "breaks":
        return "Raspusti";
      case "breakForm":
        return v.breakId ? "Izmeni raspust" : "Novi raspust";
    }
  };

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
                breakCount={breaks.length}
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
                onClose={level > 0 ? back : () => onOpenChange(false)}
              />
            ) : null}

            {effectiveView.kind === "timetable" && focusedMember ? (
              <TimetableEditorPanel
                member={focusedMember}
                anchor={anchorsByPersonId.get(focusedMember.id)}
                entries={entries}
                bell={bell}
                initialVariant={effectiveView.variant}
                initialDay={effectiveView.day}
                onDone={level > 0 ? back : () => onOpenChange(false)}
              />
            ) : null}

            {effectiveView.kind === "bell" ? (
              <BellSchedulePanel
                bell={bell}
                onClose={level > 0 ? back : () => onOpenChange(false)}
              />
            ) : null}

            {effectiveView.kind === "breaks" ? (
              <SchoolBreaksPanel
                breaks={breaks}
                memberIdsByBreak={memberIdsByBreak}
                students={students}
                onAdd={() => push({ kind: "breakForm", breakId: null })}
                onEdit={(breakId) => push({ kind: "breakForm", breakId })}
              />
            ) : null}

            {effectiveView.kind === "breakForm" ? (
              <SchoolBreakForm
                // Remount on switching between breaks: the form seeds its state
                // once, so without the key an "Izmeni" after an "Izmeni" would
                // keep the previous break's values.
                key={effectiveView.breakId ?? "new"}
                schoolBreak={
                  effectiveView.breakId
                    ? (breaks.find((b) => b.id === effectiveView.breakId) ?? null)
                    : null
                }
                initialPersonIds={
                  effectiveView.breakId
                    ? [...(memberIdsByBreak.get(effectiveView.breakId) ?? [])]
                    : []
                }
                students={students}
                onDone={level > 0 ? back : () => onOpenChange(false)}
              />
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
  breakCount,
  onPick,
  onManageFamily,
}: {
  members: ReadonlyArray<Profile>;
  anchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  timeBandByPerson: ReadonlyMap<string, SchoolShift>;
  breakCount: number;
  onPick: (view: View) => void;
  onManageFamily: () => void;
}) {
  // Only students (those with a shift anchor) get school controls here. A
  // member becomes a student via the student toggle in settings -> family.
  const students = useMemo(
    () => members.filter((member) => anchorsByPersonId.has(member.id)),
    [members, anchorsByPersonId],
  );

  return (
    <div className="space-y-4">
      {students.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            Učenici
          </h3>
          <ul className="space-y-2">
            {students.map((member) => {
              const color = member.color ?? fallbackColorForProfile(member.id);
              const name = memberName(member);
              const band = timeBandByPerson.get(member.id) ?? null;
              return (
                <li key={member.id} className="space-y-2 rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate text-sm font-semibold text-foreground">
                      {name}
                    </span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
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
        <h3 className="text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          Podešavanja
        </h3>
        <SettingsGroup>
          <SettingsRow
            icon={BellIcon}
            label="Satnica zvona"
            hint="trajanje časa, odmori, počeci smena"
            onClick={() => onPick({ kind: "bell" })}
          />
          <SettingsRow
            icon={SunIcon}
            tone="warn"
            label="Raspusti"
            hint="časovi se tada ne prikazuju"
            value={
              breakCount > 0
                ? `${breakCount} ${serbianPlural(breakCount, {
                    one: "raspust",
                    few: "raspusta",
                    many: "raspusta",
                  })}`
                : "nije podešeno"
            }
            onClick={() => onPick({ kind: "breaks" })}
          />
          <SettingsRow
            icon={UserGroupIcon}
            tone="muted"
            label="Porodica i članovi"
            hint="prekidač Učenik je tamo"
            onClick={onManageFamily}
          />
        </SettingsGroup>
      </section>
    </div>
  );
}
