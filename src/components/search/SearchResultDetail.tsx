import { Suspense, useState } from "react";

import { ExternalEventDetailDialog } from "@/components/dashboard/ExternalEventDetailDialog";
import {
  LinkedEntityEditor,
  type EditableEntityRef,
} from "@/components/payments/LinkedEntityEditor";
import { LinkedEntityViewer } from "@/components/payments/lazyLinkedEntityViewer";
import { PaymentDetailDialog } from "@/components/payments/PaymentDetailDialog";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import {
  detailSheetDates,
  nextTaskInstance,
  taskAgendaItem,
} from "@/components/tasks/taskItemModel";
import type { SearchDetailTarget } from "@/components/search/searchResultAction";
import { useExternalEventById } from "@/hooks/useExternalEvents";
import { usePaymentById } from "@/hooks/usePayments";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";

/**
 * What a global-search hit opens: the entity's own detail sheet, mounted right
 * where the user is. The palette closes first, so this is the only thing on
 * screen - the search equivalent of `useAgendaDetails`, which does the same job
 * for a tapped agenda row.
 *
 * Every kind lands on the SAME component its feature page and the agenda use,
 * so one entity looks the same wherever you reached it from:
 *
 *   - event / activity / birthday - `LinkedEntityViewer`, whose "Izmeni"
 *     delegates back here and is routed on to `LinkedEntityEditor`. Those
 *     sheets close THEMSELVES before delegating, so both setters land in the
 *     same batch and the editor takes over the level the viewer gave up.
 *   - payment - `PaymentDetailDialog` with no `onEdit`, which makes it host the
 *     edit form itself.
 *   - task - `TaskDetailSheet`, which carries its own editor as a sub-view.
 *   - external - `ExternalEventDetailDialog`, read-only by nature.
 *
 * A search hit carries an id and nothing else, so each arm resolves its own row:
 * from the family-wide caches where one exists (activities, birthdays, tasks),
 * by id where it doesn't (events, payments, mirrored Google events, all three
 * of which can sit outside every warm window).
 *
 * Renders nothing until `target` is set - the inner components mount lazily, so
 * their queries only fire once a result is actually opened.
 */
export type SearchResultDetailProps = {
  /** The opened search hit; null renders nothing. */
  target: SearchDetailTarget | null;
  /** Dismissed - the palette is already closed, so this just clears the state. */
  onClose: () => void;
};

export function SearchResultDetail({ target, onClose }: SearchResultDetailProps) {
  const [editTarget, setEditTarget] = useState<EditableEntityRef | null>(null);

  // The three kinds the shared viewer already covers; the rest fall through to
  // their own arm below.
  const viewerTarget =
    target && (target.kind === "event" || target.kind === "activity" || target.kind === "birthday")
      ? { kind: target.kind, id: target.id }
      : null;

  return (
    <>
      {/* Mounted only once a matching hit is opened: this component itself sits
          in the layout for the whole session, and rendering a `lazy()` element
          is what triggers its import - an unconditional one would pull the
          chunk in on boot and undo the split. */}
      {viewerTarget ? (
        <Suspense fallback={null}>
          <LinkedEntityViewer
            target={viewerTarget}
            onClose={onClose}
            onEdit={(next) => {
              onClose();
              setEditTarget(next);
            }}
          />
        </Suspense>
      ) : null}
      <LinkedEntityEditor target={editTarget} onClose={() => setEditTarget(null)} />

      {target?.kind === "payment" ? <PaymentHit id={target.id} onClose={onClose} /> : null}
      {target?.kind === "task" ? <TaskHit id={target.id} onClose={onClose} /> : null}
      {target?.kind === "external" ? <ExternalHit id={target.id} onClose={onClose} /> : null}
    </>
  );
}

type HitProps = { id: string; onClose: () => void };

function PaymentHit({ id, onClose }: HitProps) {
  const payment = usePaymentById(id).data ?? null;
  const { byPayment } = usePaymentParticipants();

  return (
    <PaymentDetailDialog
      open={!!payment}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      payment={payment}
      personIds={byPayment.get(id) ?? []}
      // No `onEdit`: the sheet hides itself and opens the form in place,
      // returning here on close.
    />
  );
}

function TaskHit({ id, onClose }: HitProps) {
  const { data: tasks } = useTasksList();
  const { byTask } = useTaskAssignees();
  const { byKey } = useTaskOccurrenceRows();
  const today = useToday().str;

  const task = (tasks ?? []).find((t) => t.id === id) ?? null;
  const assigneeIds = byTask.get(id) ?? [];
  // A search hit is a TASK, not one of its days, so it opens at the instance the
  // task stands for inside its own list - the next unresolved one. Null for an
  // undated task and for a series that has already ended, which is exactly the
  // case the sheet takes a null date for.
  const instance = task ? nextTaskInstance(task, today, byKey) : null;
  const item = task && instance ? taskAgendaItem(task, instance, assigneeIds, today) : null;
  const { occurrenceDate, effectiveDate } = detailSheetDates(item);

  return (
    <TaskDetailSheet
      open={!!task}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      task={task}
      occurrenceDate={occurrenceDate}
      effectiveDate={effectiveDate}
      assigneeIds={assigneeIds}
      missed={item?.missed ?? false}
    />
  );
}

function ExternalHit({ id, onClose }: HitProps) {
  const event = useExternalEventById(id).data ?? null;

  return (
    <ExternalEventDetailDialog
      open={!!event}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      event={event}
    />
  );
}
