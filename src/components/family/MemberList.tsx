import { ChevronRightIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName, getInitials } from "@/utils/identity";
import type { Profile } from "@/types/database";

export type MemberListProps = {
  members: ReadonlyArray<Profile>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Ids of members who have a school timetable + shifts (an anchor row). */
  studentIds: ReadonlySet<string>;
  currentUserId: string | null;
  /** Admins get the "+ Dodaj člana" affordance. */
  canManage: boolean;
  onAdd: () => void;
};

/** Status pill shared by every role tag on a row. */
const PILL = "rounded-full px-2 py-[3px] text-[10.5px] font-bold";

/**
 * The master pane: every family member as a selectable row. Selection is local
 * state (this lives inside a Settings tab, not its own route), so a row is a
 * button rather than a router Link. Each row summarises the member's roles -
 * login, admin, student - as tinted pills, the same shape as the Lists
 * master rows.
 */
export function MemberList({
  members,
  selectedId,
  onSelect,
  studentIds,
  currentUserId,
  canManage,
  onAdd,
}: MemberListProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 pl-1">
        <h2 className="flex items-center gap-2 text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          Članovi
          <span className="rounded-full border border-border bg-card px-2 text-[10.5px] tabular-nums">
            {members.length}
          </span>
        </h2>
        {canManage ? (
          <Button size="icon-sm" variant="ghost" onClick={onAdd} aria-label="Dodaj člana">
            <PlusIcon className="h-5 w-5" />
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            selected={member.id === selectedId}
            isStudent={studentIds.has(member.id)}
            isCurrent={member.id === currentUserId}
            onSelect={() => onSelect(member.id)}
          />
        ))}
      </div>
    </div>
  );
}

type MemberRowProps = {
  member: Profile;
  selected: boolean;
  isStudent: boolean;
  isCurrent: boolean;
  onSelect: () => void;
};

function MemberRow({ member, selected, isStudent, isCurrent, onSelect }: MemberRowProps) {
  const name =
    getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
    "Bez imena";
  const color = member.color ?? fallbackColorForProfile(member.id);
  const initials = getInitials({
    firstName: member.first_name,
    lastName: member.last_name,
    email: null,
  });

  // Compact role summary: login state, then any roles the member carries.
  const tags: Array<{ label: string; tone: string }> = [
    member.has_login
      ? { label: "Nalog", tone: "bg-pos-soft text-pos" }
      : { label: "Bez naloga", tone: "bg-muted text-muted-foreground" },
  ];
  if (member.is_admin)
    tags.push({ label: "Administrator", tone: "bg-accent-soft text-accent-deep" });
  if (isStudent) tags.push({ label: "Učenik", tone: "bg-info-soft text-info" });

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        "flex w-full items-center gap-[11px] rounded-xl border px-[13px] py-3 text-left shadow-card transition-colors",
        selected ? "border-accent bg-accent-soft" : "border-border bg-card hover:bg-muted",
      )}
    >
      <span
        className="grid size-[38px] shrink-0 place-items-center rounded-[14px] text-[13px] font-bold text-white"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-foreground">{name}</span>
          {isCurrent ? (
            <span className="text-[12.5px] font-normal text-muted-foreground">(ti)</span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <span key={tag.label} className={cn(PILL, tag.tone)}>
              {tag.label}
            </span>
          ))}
        </span>
      </span>
      <ChevronRightIcon
        className="h-4 w-4 shrink-0 text-muted-foreground lg:hidden"
        aria-hidden="true"
      />
    </button>
  );
}
