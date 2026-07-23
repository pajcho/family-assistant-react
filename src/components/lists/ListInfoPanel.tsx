import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import type { ListWithItems, Profile } from "@/types/database";
import { formatDateTime, formatRelative } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";

export type ListInfoPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: ListWithItems;
};

/**
 * Read-only info panel for one list.
 *
 * Surfaces the audit columns we now keep on `lists` and `list_items`:
 *   • who created the list (owner_id) and when
 *   • who last modified the list - note this also fires on any nested
 *     item change, since the AFTER trigger bumps the parent's stamps
 *   • a per-item activity strip with the same "created by / last edited"
 *     pair - useful for "who added Mleko to the shopping list?"
 *
 * Names come from `useFamilyMembers()` (cached profile lookup). When the
 * author has been removed from the family / their auth row deleted, the
 * FK is set to NULL and we render a neutral fallback so the panel never
 * crashes on missing data.
 */
export function ListInfoPanel({ open, onOpenChange, list }: ListInfoPanelProps) {
  const { byId } = useFamilyMembers();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Detalji liste</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Ko je kreirao listu i ko je pravio izmene.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Lista
          </h3>
          <dl className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-700/50">
            <AuditRow
              label="Kreirao"
              person={byId.get(list.owner_id)}
              timestamp={list.created_at}
            />
            <AuditRow
              label="Poslednja izmena"
              person={list.updated_by_id ? byId.get(list.updated_by_id) : undefined}
              timestamp={list.updated_at}
            />
          </dl>
        </section>

        {list.list_items.length > 0 ? (
          <section className="mt-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Aktivnost stavki
            </h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {list.list_items.map((item) => {
                const creator = item.created_by_id ? byId.get(item.created_by_id) : undefined;
                const editor = item.updated_by_id ? byId.get(item.updated_by_id) : undefined;
                // Hide the "last edited" line when it's identical to "created"
                // (the row hasn't been touched since insert). Compare the
                // timestamps - Postgres sets them equal on initial INSERT.
                const wasEdited = item.updated_at !== item.created_at;
                return (
                  <li key={item.id} className="space-y-1 px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={
                          item.is_completed
                            ? "min-w-0 truncate text-gray-400 line-through dark:text-gray-500"
                            : "min-w-0 truncate font-medium text-gray-900 dark:text-gray-100"
                        }
                      >
                        {item.name}
                      </span>
                      {item.is_completed ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          Završeno
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Dodao: <PersonLabel person={creator} /> ·{" "}
                      <time dateTime={item.created_at} title={formatDateTime(item.created_at)}>
                        {formatRelative(item.created_at)}
                      </time>
                    </p>
                    {wasEdited ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Poslednja izmena: <PersonLabel person={editor} /> ·{" "}
                        <time dateTime={item.updated_at} title={formatDateTime(item.updated_at)}>
                          {formatRelative(item.updated_at)}
                        </time>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function AuditRow({
  label,
  person,
  timestamp,
}: {
  label: string;
  person: Profile | undefined;
  timestamp: string;
}) {
  // Single-row layout at every size: label left, value (name + relative
  // time) right. The original mobile variant used flex-col which stacked
  // the value onto its own line - the wrap that produced was visually
  // confusing because the value was right-aligned on a row that looked
  // empty next to it.
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="text-gray-900 dark:text-gray-100">
          <PersonLabel person={person} />
        </span>
        <span className="ml-2 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
          <time dateTime={timestamp} title={formatDateTime(timestamp)}>
            {formatRelative(timestamp)}
          </time>
        </span>
      </dd>
    </div>
  );
}

function PersonLabel({ person }: { person: Profile | undefined }) {
  if (!person) {
    return <span className="italic text-gray-400 dark:text-gray-500">nepoznat korisnik</span>;
  }
  return (
    <span>{getDisplayName({ firstName: person.first_name, lastName: person.last_name })}</span>
  );
}
