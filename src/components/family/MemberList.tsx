import { ChevronRightIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
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

/**
 * The master pane: every family member as a selectable row. Selection is local
 * state (this lives inside a Settings tab, not its own route), so a row is a
 * button rather than a router Link. Each row summarises the member's roles -
 * login, admin, student - in a muted subtitle, the same shape as the Lists
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
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Članovi</h2>
        {canManage ? (
          <Button size="icon-sm" variant="ghost" onClick={onAdd} aria-label="Dodaj člana">
            <PlusIcon className="h-5 w-5" />
          </Button>
        ) : null}
      </div>
      <div className="space-y-0.5 p-2">
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

  // Compact role summary: login state, then any roles the member carries.
  const tags: string[] = [member.has_login ? "Nalog" : "Bez naloga"];
  if (member.is_admin) tags.push("Administrator");
  if (isStudent) tags.push("Učenik");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
        selected ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-gray-100 dark:hover:bg-gray-700/50",
      )}
    >
      <span
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {name}
          </span>
          {isCurrent ? (
            <span className="text-xs text-gray-400 dark:text-gray-500">(ti)</span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
          {tags.join(" · ")}
        </span>
      </span>
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400 lg:hidden" aria-hidden="true" />
    </button>
  );
}
