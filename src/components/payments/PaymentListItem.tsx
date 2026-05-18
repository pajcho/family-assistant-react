import {
  ArrowUturnLeftIcon,
  CheckIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Payment, RecurrencePeriod } from "@/types/database";
import { formatDate, isOverdue } from "@/utils/date";
import { formatAmount } from "@/utils/format";

/* --- Discriminated union of list-item shapes (mirrors Vue source) ---------- */

export type PaymentRowItem = Payment & { type: "payment" };

export type HistoryRowItem = {
  type: "history";
  id: string;
  payment_id: string;
  name: string;
  amount: number;
  due_date: string;
  paid_date: string;
  /** Only the latest history entry shows the Undo action. */
  isLast: boolean;
};

export type UpcomingRowItem = {
  type: "upcoming";
  id: string;
  paymentId: string;
  name: string;
  amount: number;
  due_date: string;
  description: string | null;
  recurrence_period: RecurrencePeriod | null;
  remaining_occurrences: number | null;
};

export type PaymentListItemUnion = PaymentRowItem | HistoryRowItem | UpcomingRowItem;

export type PaymentListItemProps = {
  item: PaymentListItemUnion;
  onMarkPaid: (item: PaymentRowItem) => void;
  onTogglePause: (item: PaymentRowItem) => void;
  onOpenHistory: (item: PaymentRowItem) => void;
  onEdit: (item: PaymentRowItem) => void;
  onDelete: (item: PaymentRowItem) => void;
  onUndo: (item: HistoryRowItem) => void;
};

/* --- Status pill rendering ------------------------------------------------- */

function StatusPill({ item }: { item: PaymentListItemUnion }) {
  if (item.type === "history" || (item.type === "payment" && item.is_paid)) {
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
    return (
      <span className="font-medium text-emerald-600 dark:text-emerald-400">
        Plaćeno {formatDate(item.paid_date)}
      </span>
    );
  }
  if (item.type === "upcoming") {
    return (
      <>
        <span className="font-medium text-sky-600 dark:text-sky-400">Nadolazeće</span>
        {item.recurrence_period === "monthly" ? (
          <span className="text-gray-500 dark:text-gray-400">Mesečno</span>
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
  if (item.recurrence_period === "monthly") {
    return <span className="text-amber-600 dark:text-amber-400">Mesečno</span>;
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

/* --- Action button blocks (mobile kebab vs desktop inline) ----------------- */

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
      {/* Mobile: kebab dropdown with the single Undo action */}
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
      {/* Desktop: single outline button */}
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
  onMarkPaid,
  onTogglePause,
  onOpenHistory,
  onEdit,
  onDelete,
}: {
  item: PaymentRowItem;
  onMarkPaid: (item: PaymentRowItem) => void;
  onTogglePause: (item: PaymentRowItem) => void;
  onOpenHistory: (item: PaymentRowItem) => void;
  onEdit: (item: PaymentRowItem) => void;
  onDelete: (item: PaymentRowItem) => void;
}) {
  const canPause = !item.is_paid && item.recurrence_period !== "one-time";
  const canMarkPaid = !item.is_paid && !item.is_paused;
  const showHistory = item.recurrence_period !== "one-time";

  return (
    <>
      {/* Mobile: single kebab dropdown */}
      <div className="flex shrink-0 sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Akcije">
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canMarkPaid ? (
              <DropdownMenuItem onSelect={() => onMarkPaid(item)}>
                <CheckIcon className="h-4 w-4" />
                Označi kao plaćeno
              </DropdownMenuItem>
            ) : null}
            {canPause && item.is_paused ? (
              <DropdownMenuItem onSelect={() => onTogglePause(item)}>
                <PlayIcon className="h-4 w-4" />
                Nastavi
              </DropdownMenuItem>
            ) : null}
            {canPause && !item.is_paused ? (
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
      {/* Desktop: inline button row */}
      <div className="hidden shrink-0 flex-wrap justify-end gap-2 sm:flex">
        {canPause ? (
          item.is_paused ? (
            <Button variant="outline" size="sm" onClick={() => onTogglePause(item)}>
              Nastavi
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onTogglePause(item)}>
              Pauziraj
            </Button>
          )
        ) : null}
        {canMarkPaid ? (
          <Button variant="success" size="sm" onClick={() => onMarkPaid(item)}>
            Plaćeno
          </Button>
        ) : null}
        {showHistory ? (
          <Button variant="outline" size="sm" onClick={() => onOpenHistory(item)}>
            <ClockIcon className="mr-1 h-4 w-4" />
            Istorija
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => onEdit(item)}>
          <PencilIcon className="mr-1 h-4 w-4" />
          Izmeni
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(item)}>
          <TrashIcon className="mr-1 h-4 w-4" />
          Obriši
        </Button>
      </div>
    </>
  );
}

/* --- The component itself -------------------------------------------------- */

/**
 * Direct port of `components/payments/PaymentListItem.vue` from the sibling
 * Nuxt app.
 *
 * Polymorphic over the discriminated union (`payment | history | upcoming`).
 * Keeps the three branches inline rather than splitting into three siblings
 * because the shared header (name + status pill + date·amount + description
 * + meta line) makes a single render path read cleaner than a switch in the
 * parent.
 *
 * The action set varies by item type — see the per-type Actions component
 * above. Upcoming rows show no actions at all (informational only).
 */
export function PaymentListItem(props: PaymentListItemProps) {
  const { item } = props;
  const description = "description" in item ? item.description : null;

  return (
    <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-gray-900 dark:text-gray-100">{item.name}</p>
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
        </div>
      </div>

      {item.type === "history" ? <HistoryActions item={item} onUndo={props.onUndo} /> : null}

      {item.type === "payment" ? (
        <PaymentActions
          item={item}
          onMarkPaid={props.onMarkPaid}
          onTogglePause={props.onTogglePause}
          onOpenHistory={props.onOpenHistory}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
        />
      ) : null}

      {/* upcoming rows render no actions (informational only) */}
    </div>
  );
}
