import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import type { AuditedByMember, Profile } from "@/types/database";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatRelative } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";

/**
 * The authorship line every detail sheet ends with: who added this thing, and
 * who last touched it.
 *
 * Deliberately NOT a `DetailActionRow`. The sheets are already five and six
 * actions deep and a sixth bordered row for something you only read would make
 * the ones you act on harder to find. This is a caption: quiet, one line,
 * answering the common question ("ko je ovo dodao") with no tap at all, and
 * drilling into the full change history with one when `onOpenHistory` is wired
 * (plan 018, PR 3 - until then the line is text only).
 */

/** The audit shape every entity table carries, plus its two timestamps. */
export type AuditedRow = AuditedByMember & {
  created_at: string;
  updated_at: string;
};

/**
 * Serbian has gendered past participles and the app does not know a member's
 * gender, so "Dodala Marija" is wrong for Nikola and "Dodao" is wrong for
 * Marija. Every verb here is therefore the neuter passive ("Dodato",
 * "izmenjeno"), which agrees with the thing rather than the person. Same
 * constraint that shaped `progressLine()` in TaskHistoryPanel.
 */
function nameOf(person: Profile | undefined): string | null {
  if (!person) return null;
  return (
    getDisplayName({
      firstName: person.first_name,
      lastName: person.last_name,
      email: null,
    }) || null
  );
}

export type DetailAuditLineProps = {
  row: AuditedRow;
  /** Opens the change-history sub-view. Omit to render a plain caption. */
  onOpenHistory?: () => void;
  className?: string;
};

export function DetailAuditLine({ row, onOpenHistory, className }: DetailAuditLineProps) {
  const { byId } = useFamilyMembers();

  const creator = row.created_by_id ? nameOf(byId.get(row.created_by_id)) : null;
  const editor = row.updated_by_id ? nameOf(byId.get(row.updated_by_id)) : null;
  // Postgres writes the two timestamps equal on INSERT, so an untouched row is
  // one where they still match - the same test ListInfoPanel applies per item.
  // Comparing the timestamps rather than the ids matters: an edit by the person
  // who created it leaves `updated_by_id` unchanged and would read as "never
  // edited" if we compared authors.
  const wasEdited = row.updated_at !== row.created_at;
  const sameAuthor = row.created_by_id != null && row.created_by_id === row.updated_by_id;

  // An exact date for the creation (eight months on, "pre 8 meseci" is worse
  // than "12.01.2026") and a relative one for the edit, where recency is the
  // whole point.
  const created = creator
    ? `Dodato: ${creator} · ${formatDate(row.created_at)}`
    : `Dodato ${formatDate(row.created_at)}`;
  const edited = !wasEdited
    ? null
    : editor && !sameAuthor
      ? `izmenjeno: ${editor} · ${formatRelative(row.updated_at)}`
      : `izmenjeno ${formatRelative(row.updated_at)}`;

  const body = (
    <>
      <span className="min-w-0 flex-1 text-left leading-snug">
        <span title={formatDateTime(row.created_at)}>{created}</span>
        {edited ? (
          <>
            {" · "}
            <span title={formatDateTime(row.updated_at)}>{edited}</span>
          </>
        ) : null}
      </span>
      {onOpenHistory ? <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" /> : null}
    </>
  );

  const shared = cn(
    "flex w-full items-center gap-2 px-0.5 pt-2.5 text-xs text-muted-foreground",
    className,
  );

  if (!onOpenHistory) {
    return <p className={shared}>{body}</p>;
  }

  return (
    <button
      type="button"
      onClick={onOpenHistory}
      className={cn(
        shared,
        "min-h-11 rounded-md transition-colors hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      {body}
    </button>
  );
}
