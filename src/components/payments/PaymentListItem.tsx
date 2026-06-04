import {
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type {
  Payment,
  PaymentHistoryStatus,
  PaymentOverride,
  RecurrencePeriod,
} from "@/types/database";
import { formatDate, isOverdue } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { recurrenceLabel } from "@/utils/payment";

/* --- Discriminated union of list-item shapes (mirrors Vue source) ---------- */

export type PaymentRowItem = Payment & {
  type: "payment";
  /** Original projected due date — the override key. Equals due_date when not moved. */
  occurrenceDate: string;
  override?: PaymentOverride | null;
};

export type HistoryRowItem = {
  type: "history";
  id: string;
  payment_id: string;
  name: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  status: PaymentHistoryStatus;
  note: string | null;
  /** Only the latest history entry shows the Undo action. */
  isLast: boolean;
};

export type UpcomingRowItem = {
  type: "upcoming";
  id: string;
  paymentId: string;
  name: string;
  amount: number;
  /** Effective (displayed) date — override_date when rescheduled, else the occurrence. */
  due_date: string;
  /** Original projected due date — the override key. */
  occurrenceDate: string;
  override?: PaymentOverride | null;
  description: string | null;
  recurrence_period: RecurrencePeriod | null;
  recurrence_interval: number;
  remaining_occurrences: number | null;
};

export type PaymentListItemUnion = PaymentRowItem | HistoryRowItem | UpcomingRowItem;

/** Context an occurrence action needs (reschedule/cancel/restore). */
export type OccurrenceContext = {
  paymentId: string;
  occurrenceDate: string;
  /** Current effective date (for prefilling the reschedule picker). */
  currentDate: string;
  isRecurring: boolean;
  name: string;
};

export type PaymentListItemProps = {
  item: PaymentListItemUnion;
  /** Assignees of the underlying payment (empty = unassigned). */
  personIds: string[];
  onMarkPaid: (item: PaymentRowItem) => void;
  onTogglePause: (item: PaymentRowItem) => void;
  onOpenHistory: (item: PaymentRowItem) => void;
  onEdit: (item: PaymentRowItem) => void;
  onDelete: (item: PaymentRowItem) => void;
  onUndo: (item: HistoryRowItem) => void;
  onRescheduleOccurrence: (ctx: OccurrenceContext) => void;
  onCancelOccurrence: (ctx: {
    paymentId: string;
    occurrenceDate: string;
    name: string;
    isRecurring: boolean;
  }) => void;
  onRestoreOccurrence: (ctx: { paymentId: string; occurrenceDate: string }) => void;
};

function overrideOf(item: PaymentListItemUnion): PaymentOverride | null {
  return "override" in item ? (item.override ?? null) : null;
}

/* --- Status pill rendering ------------------------------------------------- */

function StatusPill({ item }: { item: PaymentListItemUnion }) {
  const override = overrideOf(item);
  if (override?.action === "cancel") {
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
        Otkazano
      </span>
    );
  }
  if (override?.action === "reschedule") {
    return (
      <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
        Pomereno
      </span>
    );
  }
  if (item.type === "history") {
    return item.status === "canceled" ? (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
        Otkazano
      </span>
    ) : (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
        Plaćeno
      </span>
    );
  }
  if (item.type === "payment" && item.is_paid) {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
        Plaćeno
      </span>
    );
  }
  if (item.type === "payment" && !item.is_paused && isOverdue(item.due_date)) {
    return (
      <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-800/60 dark:text-red-200">
        Prekoračeno
      </span>
    );
  }
  if (item.type === "upcoming") {
    return (
      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/50 dark:text-sky-400">
        Nadolazeće
      </span>
    );
  }
  return null;
}

/* --- Status footer (extra meta line) --------------------------------------- */

function StatusMeta({ item }: { item: PaymentListItemUnion }) {
  if (item.type === "history") {
    if (item.status === "canceled") {
      return (
        <span className="font-medium text-red-600 dark:text-red-400">
          Otkazano{item.note ? ` · ${item.note}` : ""}
        </span>
      );
    }
    return (
      <span className="font-medium text-emerald-600 dark:text-emerald-400">
        Plaćeno {item.paid_date ? formatDate(item.paid_date) : ""}
      </span>
    );
  }
  if (item.type === "upcoming") {
    return (
      <>
        <span className="font-medium text-sky-600 dark:text-sky-400">Nadolazeće</span>
        {item.recurrence_period === "monthly" || item.recurrence_period === "weekly" ? (
          <span className="text-gray-500 dark:text-gray-400">
            {recurrenceLabel(item.recurrence_period, item.recurrence_interval)}
          </span>
        ) : null}
        {item.recurrence_period === "limited" && item.remaining_occurrences != null ? (
          <span className="text-gray-500 dark:text-gray-400">
            Ostalo {item.remaining_occurrences} uplata
          </span>
        ) : null}
      </>
    );
  }
  // payment row
  if (item.is_paused) {
    return <span className="font-medium text-gray-500 dark:text-gray-400">Pauzirano</span>;
  }
  if (item.is_paid) {
    return (
      <span className="font-medium text-emerald-600 dark:text-emerald-400">
        Plaćeno {item.paid_date ? formatDate(item.paid_date) : ""}
      </span>
    );
  }
  if (item.recurrence_period === "monthly" || item.recurrence_period === "weekly") {
    return (
      <span className="text-amber-600 dark:text-amber-400">
        {recurrenceLabel(item.recurrence_period, item.recurrence_interval)}
      </span>
    );
  }
  if (item.recurrence_period === "limited") {
    return (
      <span className="text-amber-600 dark:text-amber-400">
        Ostalo {item.remaining_occurrences ?? 0} uplata
      </span>
    );
  }
  return <span className="text-gray-500 dark:text-gray-400">Jednokratno</span>;
}

/* --- Per-occurrence action menu items (reschedule / cancel / restore) ------- */

type OccurrenceCallbacks = Pick<
  PaymentListItemProps,
  "onRescheduleOccurrence" | "onCancelOccurrence" | "onRestoreOccurrence"
>;

function occurrenceContext(item: PaymentRowItem | UpcomingRowItem): OccurrenceContext {
  const paymentId = item.type === "payment" ? item.id : item.paymentId;
  const isRecurring =
    item.type === "payment"
      ? item.recurrence_period !== "one-time" && item.recurrence_period != null
      : true;
  return {
    paymentId,
    occurrenceDate: item.occurrenceDate,
    currentDate: item.due_date,
    isRecurring,
    name: item.name,
  };
}

/** The Pomeri/Otkaži (or Vrati) dropdown items for one occurrence. */
function OccurrenceMenuItems({
  item,
  callbacks,
}: {
  item: PaymentRowItem | UpcomingRowItem;
  callbacks: OccurrenceCallbacks;
}) {
  const ctx = occurrenceContext(item);
  if (overrideOf(item)) {
    return (
      <DropdownMenuItem
        onSelect={() =>
          callbacks.onRestoreOccurrence({
            paymentId: ctx.paymentId,
            occurrenceDate: ctx.occurrenceDate,
          })
        }
      >
        <ArrowUturnLeftIcon className="h-4 w-4" />
        Vrati ratu
      </DropdownMenuItem>
    );
  }
  return (
    <>
      <DropdownMenuItem onSelect={() => callbacks.onRescheduleOccurrence(ctx)}>
        <CalendarDaysIcon className="h-4 w-4" />
        Pomeri ratu
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() =>
          callbacks.onCancelOccurrence({
            paymentId: ctx.paymentId,
            occurrenceDate: ctx.occurrenceDate,
            name: ctx.name,
            isRecurring: ctx.isRecurring,
          })
        }
      >
        <XCircleIcon className="h-4 w-4" />
        Otkaži ratu
      </DropdownMenuItem>
    </>
  );
}

/* --- Action block: one primary action + overflow (⋮) menu ------------------ */

function HistoryActions({
  item,
  onUndo,
}: {
  item: HistoryRowItem;
  onUndo: (item: HistoryRowItem) => void;
}) {
  if (!item.isLast) return null;
  return (
    <>
      <div className="flex shrink-0 sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Akcije">
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onUndo(item)}>
              <ArrowUturnLeftIcon className="h-4 w-4" />
              Poništi
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="hidden shrink-0 sm:flex">
        <Button variant="outline" size="sm" onClick={() => onUndo(item)}>
          Poništi
        </Button>
      </div>
    </>
  );
}

function PaymentActions({
  item,
  callbacks,
  onMarkPaid,
  onTogglePause,
  onOpenHistory,
  onEdit,
  onDelete,
}: {
  item: PaymentRowItem;
  callbacks: OccurrenceCallbacks;
  onMarkPaid: (item: PaymentRowItem) => void;
  onTogglePause: (item: PaymentRowItem) => void;
  onOpenHistory: (item: PaymentRowItem) => void;
  onEdit: (item: PaymentRowItem) => void;
  onDelete: (item: PaymentRowItem) => void;
}) {
  const isCanceled = overrideOf(item)?.action === "cancel";
  const isOneTime = item.recurrence_period === "one-time";
  // A canceled occurrence can't be paid/paused — restore it first.
  const canPause = !item.is_paid && !isCanceled && !isOneTime;
  const canMarkPaid = !item.is_paid && !item.is_paused && !isCanceled;
  const showHistory = !isOneTime;
  const showPauseItem = canPause && !item.is_paused;
  // Kebab groups, divided when adjacent groups are non-empty:
  //   [Pauziraj/Istorija] · [Pomeri/Otkaži, or Vrati] · [Izmeni/Obriši].
  // The middle group is empty when canceled (Vrati is the primary button then).
  const hasStateGroup = showPauseItem || showHistory;
  const hasOccurrenceGroup = !isCanceled;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Primary action — the single most likely next step for this status. */}
      {isCanceled ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            callbacks.onRestoreOccurrence({
              paymentId: item.id,
              occurrenceDate: item.occurrenceDate,
            })
          }
        >
          <ArrowUturnLeftIcon className="mr-1 h-4 w-4" />
          Vrati ratu
        </Button>
      ) : item.is_paused ? (
        <Button variant="outline" size="sm" onClick={() => onTogglePause(item)}>
          <PlayIcon className="mr-1 h-4 w-4" />
          Nastavi
        </Button>
      ) : canMarkPaid ? (
        <Button variant="outline" size="sm" onClick={() => onMarkPaid(item)}>
          <CheckIcon className="mr-1 h-4 w-4 text-green-600 dark:text-green-500" />
          Plaćeno
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Akcije">
            <EllipsisVerticalIcon className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showPauseItem ? (
            <DropdownMenuItem onSelect={() => onTogglePause(item)}>
              <PauseIcon className="h-4 w-4" />
              Pauziraj
            </DropdownMenuItem>
          ) : null}
          {showHistory ? (
            <DropdownMenuItem onSelect={() => onOpenHistory(item)}>
              <ClockIcon className="h-4 w-4" />
              Istorija
            </DropdownMenuItem>
          ) : null}
          {hasStateGroup && hasOccurrenceGroup ? <DropdownMenuSeparator /> : null}
          {hasOccurrenceGroup ? <OccurrenceMenuItems item={item} callbacks={callbacks} /> : null}
          {hasStateGroup || hasOccurrenceGroup ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => onEdit(item)}>
            <PencilIcon className="h-4 w-4" />
            Izmeni
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
            <TrashIcon className="h-4 w-4" />
            Obriši
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* --- The component itself -------------------------------------------------- */

/**
 * Polymorphic over the discriminated union (`payment | history | upcoming`).
 *
 * `payment` and `upcoming` rows can carry a per-occurrence `override`
 * (cancel → struck-through "Otkazano"; reschedule → "Pomereno", shown on the
 * new date) and expose Pomeri/Otkaži/Vrati actions. History rows are paid and
 * immutable.
 */
export function PaymentListItem(props: PaymentListItemProps) {
  const { item, personIds } = props;
  const description = "description" in item ? item.description : null;
  const override = overrideOf(item);
  const isCanceled =
    override?.action === "cancel" || (item.type === "history" && item.status === "canceled");
  const callbacks: OccurrenceCallbacks = {
    onRescheduleOccurrence: props.onRescheduleOccurrence,
    onCancelOccurrence: props.onCancelOccurrence,
    onRestoreOccurrence: props.onRestoreOccurrence,
  };

  return (
    <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "font-medium text-gray-900 dark:text-gray-100",
              isCanceled && "text-gray-500 line-through dark:text-gray-500",
            )}
          >
            {item.name}
          </p>
          <StatusPill item={item} />
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {formatDate(item.due_date)} · {formatAmount(item.amount)}
        </p>
        {description ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          <StatusMeta item={item} />
          {override?.action === "reschedule" && "occurrenceDate" in item ? (
            <span className="text-indigo-600 dark:text-indigo-400">
              Pomereno sa {formatDate(item.occurrenceDate)}
            </span>
          ) : null}
          {override?.reason ? (
            <span className="text-gray-500 italic dark:text-gray-400">„{override.reason}"</span>
          ) : null}
        </div>
        {personIds.length > 0 ? (
          <MemberBadges personIds={personIds} className="mt-2" size="xs" />
        ) : null}
      </div>

      {item.type === "history" ? <HistoryActions item={item} onUndo={props.onUndo} /> : null}

      {item.type === "payment" ? (
        <PaymentActions
          item={item}
          callbacks={callbacks}
          onMarkPaid={props.onMarkPaid}
          onTogglePause={props.onTogglePause}
          onOpenHistory={props.onOpenHistory}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
        />
      ) : null}

      {/* Upcoming rows are informational — per-occurrence actions (Pomeri /
          Otkaži) live on the current (live) row, since "move to next" only
          applies to the current occurrence. */}
    </div>
  );
}
