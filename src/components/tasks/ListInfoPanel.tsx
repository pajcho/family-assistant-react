import { useState } from "react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { AuditTimeline } from "@/components/common/AuditTimeline";
import { DetailAuditLine } from "@/components/common/DetailAuditLine";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import type { ListWithTasks, Profile } from "@/types/database";
import { formatDateTime, formatRelative } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";

export type ListInfoPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: ListWithTasks;
};

/**
 * Read-only info panel for one list: who made it, who last touched it, and the
 * same pair per item - which is what answers "ko je dodao Mleko na spisak"
 * without opening thirty task sheets.
 *
 * The list's own authorship moved onto `DetailAuditLine` (plan 018), so it now
 * reads exactly as it does on every other detail sheet in the app, and tapping
 * it opens the full change history. The per-item strip stays because it is a
 * different question: a glance across the whole list rather than one row's
 * history.
 *
 * Note the list's stamps also move when any item inside it changes - the AFTER
 * trigger bumps the parent - so "izmenjeno" here can mean "somebody ticked
 * something", not "somebody renamed the list".
 */
export function ListInfoPanel({ open, onOpenChange, list }: ListInfoPanelProps) {
  const { byId } = useFamilyMembers();
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <>
      <ResponsiveDialog open={open && !auditOpen} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Detalji liste</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Ko je kreirao listu i ko je pravio izmene.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {/* `lists` records its creator as `owner_id`, not `created_by_id` -
              it doubles as the access guard for a personal list - so the shared
              line is fed the pair it expects. */}
          <DetailAuditLine
            row={{
              created_by_id: list.owner_id,
              updated_by_id: list.updated_by_id,
              created_at: list.created_at,
              updated_at: list.updated_at,
            }}
            onOpenHistory={() => setAuditOpen(true)}
          />

          {list.tasks.length > 0 ? (
            <section className="mt-4 space-y-3">
              <h3 className="text-xs font-normal tracking-wide text-muted-foreground uppercase">
                Aktivnost stavki
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {list.tasks.map((item) => {
                  const creator = item.created_by_id ? byId.get(item.created_by_id) : undefined;
                  const editor = item.updated_by_id ? byId.get(item.updated_by_id) : undefined;
                  // Hide the "last edited" line when it is identical to
                  // "created" (the row has not been touched since insert).
                  // Postgres sets the two timestamps equal on INSERT.
                  const wasEdited = item.updated_at !== item.created_at;
                  return (
                    <li key={item.id} className="space-y-1 px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={
                            item.is_completed
                              ? "min-w-0 truncate text-muted-foreground line-through"
                              : "min-w-0 truncate font-medium text-foreground"
                          }
                        >
                          {item.name}
                        </span>
                        {item.is_completed ? (
                          <span className="shrink-0 rounded-full bg-pos-soft px-2 py-0.5 text-xs font-semibold text-pos">
                            Završeno
                          </span>
                        ) : null}
                      </div>
                      {/* "Dodato", not "Dodao" - the app does not know a
                          member's gender, and the masculine default was wrong
                          for half the family. Same rule as DetailAuditLine. */}
                      <p className="text-xs text-muted-foreground">
                        Dodato: <PersonLabel person={creator} /> ·{" "}
                        <time dateTime={item.created_at} title={formatDateTime(item.created_at)}>
                          {formatRelative(item.created_at)}
                        </time>
                      </p>
                      {wasEdited ? (
                        <p className="text-xs text-muted-foreground">
                          Izmenjeno: <PersonLabel person={editor} /> ·{" "}
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

      {/* A NEW overlay over this one, the SheetStack convention - done with a
          boolean because this panel is a plain dialog rather than a stack. */}
      <ResponsiveDialog open={auditOpen} onOpenChange={setAuditOpen}>
        <ResponsiveDialogContent>
          <SheetStackHeader title="Istorija izmena" onBack={() => setAuditOpen(false)} />
          <AuditTimeline entityType="lists" entityId={list.id} />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

function PersonLabel({ person }: { person: Profile | undefined }) {
  if (!person) {
    return <span className="text-muted-foreground italic">nepoznat korisnik</span>;
  }
  return (
    <span>{getDisplayName({ firstName: person.first_name, lastName: person.last_name })}</span>
  );
}
