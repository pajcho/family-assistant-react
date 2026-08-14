import { useMemo } from "react";

import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { renderChanges, type AuditResolvers } from "@/components/common/auditFields";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useListsWithTasks } from "@/hooks/useTasks";
import type { AuditLogEntry } from "@/types/database";
import { formatDate, formatDateTime } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";

/**
 * "Istorija izmena" - one entity's change history, as a sub-view on the sheet
 * stack (plan 018).
 *
 * Named apart from the two histories that already exist on purpose:
 * `PaymentHistoryPanel` answers which months were paid, `TaskHistoryPanel`
 * answers which repeats were done or skipped. Those are facts about the
 * DOMAIN. This one is about the RECORD - who edited which field, and from
 * what - so no sheet ever shows two rows with the same word meaning different
 * things.
 *
 * Mounted only while the sub-view is open, which is what makes the three
 * lookup hooks below affordable: they resolve the ids the trigger could not
 * (a category, a member, a list), and two of the three are cache hits off
 * screens the user has already visited.
 */

/** Nothing about a family's history is worth an em dash of ceremony. */
const DASH = "-";

function useResolvers(): AuditResolvers {
  const { byId: membersById } = useFamilyMembers();
  const { byId: categoriesById } = useExpenseCategories();
  const listsQuery = useListsWithTasks();

  return useMemo(() => {
    const listsById = new Map((listsQuery.data ?? []).map((l) => [l.id, l.name]));
    return {
      member: (id) => {
        const person = membersById.get(id);
        return person
          ? getDisplayName({
              firstName: person.first_name,
              lastName: person.last_name,
              email: null,
            }) || null
          : null;
      },
      category: (id) => categoriesById.get(id)?.name ?? null,
      list: (id) => listsById.get(id) ?? null,
    };
  }, [membersById, categoriesById, listsQuery.data]);
}

/** "14.08.2026" -> the entries written that day, newest day first. */
function groupByDay(entries: AuditLogEntry[]): { day: string; entries: AuditLogEntry[] }[] {
  const groups: { day: string; entries: AuditLogEntry[] }[] = [];
  for (const entry of entries) {
    const day = entry.created_at.slice(0, 10);
    const last = groups.at(-1);
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

function timeOf(iso: string): string {
  // formatDateTime is "DD.MM.YYYY HH:mm"; inside a day-grouped list the date
  // half is already on the heading above.
  const stamp = formatDateTime(iso);
  return stamp.slice(-5);
}

export type AuditTimelineProps = {
  /** The subject table name, matching `audit_log.entity_type`. */
  entityType: string;
  entityId: string | null;
};

export function AuditTimeline({ entityType, entityId }: AuditTimelineProps) {
  const { entries, isLoading } = useAuditLog(entityType, entityId);
  const { byId: membersById } = useFamilyMembers();
  const resolvers = useResolvers();

  if (isLoading) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Učitavam…</p>;
  }

  if (entries.length === 0) {
    // `filter`, not `starter`: there is nothing to pitch and nothing to create
    // here. The sentence exists so an old entity with no entries reads as
    // "nothing was recorded" rather than as a screen that failed to load.
    return (
      <EmptyState
        variant="filter"
        title="Nema zabeleženih izmena"
        description="Izmene se beleže od kada je ova mogućnost uključena, pa starije promene nisu sačuvane."
      />
    );
  }

  return (
    <div className="flex flex-col">
      {groupByDay(entries).map((group) => (
        <section key={group.day}>
          <h3 className="pt-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {formatDate(group.day)}
          </h3>
          <ul className="flex flex-col">
            {group.entries.map((entry) => {
              const person = entry.actor_id ? membersById.get(entry.actor_id) : undefined;
              const name = person
                ? getDisplayName({
                    firstName: person.first_name,
                    lastName: person.last_name,
                    email: null,
                  })
                : "Nepoznato ko";
              const rows = renderChanges(entry.entity_type, entry.changes, resolvers);

              return (
                <li
                  key={entry.id}
                  className="flex gap-2.5 border-t border-border py-2.5 first:border-t-0"
                >
                  <MemberAvatar
                    member={person}
                    personId={entry.actor_id ?? undefined}
                    size="sm"
                    title={name}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    {/* Name and time as a byline, never "Marija je promenila":
                        Serbian past participles are gendered and the app does
                        not know a member's gender. What changed goes below, as
                        noun phrases that need no agreement. */}
                    <p className="text-[13px]">
                      <span className="font-semibold">{name}</span>
                      <span className="text-muted-foreground"> · {timeOf(entry.created_at)}</span>
                    </p>

                    {entry.action === "create" ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">Kreirano</p>
                    ) : entry.action === "delete" ? (
                      <p className="mt-0.5 text-xs">
                        <span className="font-medium text-neg">Obrisano</span>
                        {entry.label ? (
                          <span className="text-muted-foreground"> · {entry.label}</span>
                        ) : null}
                      </p>
                    ) : rows.length === 0 ? (
                      // Every changed column was one this build cannot render -
                      // an older entry, or a field dropped from the registry.
                      <p className="mt-0.5 text-xs text-muted-foreground">Izmenjeno</p>
                    ) : (
                      <dl className="mt-1 flex flex-col gap-0.5">
                        {rows.map((row) => (
                          <div
                            key={row.label}
                            className="flex flex-wrap items-baseline gap-x-1.5 text-xs"
                          >
                            <dt className="text-muted-foreground">{row.label}</dt>
                            <dd className="min-w-0">
                              <span className="text-muted-foreground line-through">
                                {row.from ?? DASH}
                              </span>
                              <span className="px-1 text-muted-foreground">{"->"}</span>
                              <span className="font-semibold">{row.to ?? DASH}</span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="pt-3 text-[11px] text-muted-foreground">Izmene se čuvaju 12 meseci.</p>
    </div>
  );
}
