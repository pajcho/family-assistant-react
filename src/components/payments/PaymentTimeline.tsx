import { useMemo } from "react";
import { format } from "date-fns";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { PaymentListItemUnion } from "@/components/payments/paymentRowTypes";
import { useToday } from "@/hooks/useToday";
import { addDays, formatDate, isOverdue } from "@/utils/date";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { recurrenceLabel } from "@/utils/payment";

/**
 * The /payments list, rendered as a "Uskoro"-style timeline: a "Prekoračeno"
 * section for overdue unpaid bills up top, then everything else grouped under a
 * shared day header (reuses `AgendaDateHeader`). Rows are compact and tappable -
 * every action lives in the detail popup the tap opens, so no row carries inline
 * buttons. Resolved / paused / upcoming occurrences render dimmed in place and
 * are hidden by the "Sakrij plaćena" toggle upstream.
 *
 * `flat` (search mode) drops the grouping and the overdue split - results span
 * every month, newest first, so day headers would only add noise.
 */
export type PaymentTimelineProps = {
  items: PaymentListItemUnion[];
  /** Assignees keyed by payment id. */
  byPayment: Map<string, string[]>;
  onSelect: (item: PaymentListItemUnion) => void;
  flat?: boolean;
};

type ChipTone = "neg" | "pos" | "info" | "neutral";

const CHIP_TONE: Record<ChipTone, string> = {
  neg: "bg-neg-soft text-neg",
  pos: "bg-pos-soft text-pos",
  info: "bg-info-soft text-info",
  neutral: "bg-muted text-muted-foreground",
};

function overrideOf(item: PaymentListItemUnion) {
  return "override" in item ? (item.override ?? null) : null;
}

/** Overdue = an unpaid, un-paused, un-canceled LIVE occurrence past its due date. */
function isOverdueLive(item: PaymentListItemUnion): boolean {
  return (
    item.type === "payment" &&
    !item.is_paid &&
    !item.is_paused &&
    overrideOf(item)?.action !== "cancel" &&
    isOverdue(item.due_date)
  );
}

function isDimmed(item: PaymentListItemUnion): boolean {
  if (item.type === "history" || item.type === "upcoming") return true;
  if (overrideOf(item)?.action === "cancel") return true;
  return item.type === "payment" && (item.is_paid || item.is_paused);
}

function isStruck(item: PaymentListItemUnion): boolean {
  if (overrideOf(item)?.action === "cancel") return true;
  return item.type === "history" && item.status === "canceled";
}

function chipFor(
  item: PaymentListItemUnion,
  inOverdue: boolean,
): { label: string; tone: ChipTone } | null {
  const override = overrideOf(item);
  if (override?.action === "cancel") return { label: "Otkazano", tone: "neg" };
  if (override?.action === "reschedule") return { label: "Pomereno", tone: "info" };
  if (item.type === "history") {
    return item.status === "canceled"
      ? { label: "Preskočeno", tone: "neutral" }
      : { label: "Plaćeno", tone: "pos" };
  }
  if (item.type === "upcoming") return { label: "Nadolazeće", tone: "neutral" };
  // live payment row
  if (item.is_paid) return { label: "Plaćeno", tone: "pos" };
  if (item.is_paused) return { label: "Pauzirano", tone: "neutral" };
  // Suppressed inside the "Prekoračeno" section - the header already says it.
  if (!inOverdue && isOverdue(item.due_date)) return { label: "Prekoračeno", tone: "neg" };
  return null;
}

function metaFor(item: PaymentListItemUnion, inOverdue: boolean): string {
  if (inOverdue) return `Dospelo ${formatDate(item.due_date)}`;
  const override = overrideOf(item);
  if (override?.action === "reschedule" && "occurrenceDate" in item) {
    return `Pomereno sa ${formatDate(item.occurrenceDate)}`;
  }
  if (override?.action === "cancel") {
    return override.reason ? `Otkazano · ${override.reason}` : "Otkazano";
  }
  if (item.type === "history") {
    if (item.status === "canceled") return item.note ? `Preskočeno · ${item.note}` : "Preskočeno";
    return item.paid_date ? `Plaćeno ${formatDate(item.paid_date)}` : "Plaćeno";
  }
  if (item.type === "upcoming") {
    return recurrenceLabel(item.recurrence_period, item.recurrence_interval);
  }
  if (item.is_paused) return "Pauzirano";
  if (item.is_paid) return item.paid_date ? `Plaćeno ${formatDate(item.paid_date)}` : "Plaćeno";
  return recurrenceLabel(item.recurrence_period, item.recurrence_interval);
}

function PaymentTimelineRow({
  item,
  personIds,
  inOverdue,
  onSelect,
}: {
  item: PaymentListItemUnion;
  personIds: string[];
  inOverdue: boolean;
  onSelect: (item: PaymentListItemUnion) => void;
}) {
  const chip = chipFor(item, inOverdue);
  const dimmed = isDimmed(item);
  const struck = isStruck(item);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        className={cn(
          "block w-full rounded-lg px-2 py-2 text-left transition-colors",
          inOverdue ? "hover:bg-neg/10" : "hover:bg-muted",
          dimmed && "opacity-60",
        )}
      >
        {/* Left column (name + meta) and right column (amount, € original,
            status chip - all pinned to the row's right edge) are siblings, so
            the annotation can never push the meta row down and the chip stays
            exactly where it always was: bottom right. */}
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate font-medium text-foreground",
                struck && "text-muted-foreground line-through",
              )}
            >
              {item.name}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{metaFor(item, inOverdue)}</span>
              {personIds.length > 0 ? (
                <span className="shrink-0">
                  <MemberBadges personIds={personIds} size="xs" />
                </span>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="font-bold tracking-[-0.01em] tabular-nums text-foreground">
              <Amount value={item.amount} />
            </span>
            <AmountOriginal
              amount={item.original_amount}
              currency={item.currency}
              className="text-[10px]"
            />
            {chip ? (
              <span
                className={cn(
                  "rounded-full px-2 py-[3px] text-[10.5px] font-bold",
                  CHIP_TONE[chip.tone],
                )}
              >
                {chip.label}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function paymentIdForItem(item: PaymentListItemUnion): string {
  if (item.type === "payment") return item.id;
  if (item.type === "upcoming") return item.paymentId;
  return item.payment_id;
}

export function PaymentTimeline({
  items,
  byPayment,
  onSelect,
  flat = false,
}: PaymentTimelineProps) {
  const { str: today, date: todayDate } = useToday();
  const tomorrow = useMemo(() => format(addDays(todayDate, 1), "yyyy-MM-dd"), [todayDate]);

  const { overdueItems, dayGroups } = useMemo(() => {
    if (flat) return { overdueItems: [], dayGroups: [] as [string, PaymentListItemUnion[]][] };
    const overdue: PaymentListItemUnion[] = [];
    const byDay = new Map<string, PaymentListItemUnion[]>();
    for (const item of items) {
      if (isOverdueLive(item)) {
        overdue.push(item);
        continue;
      }
      const key = item.due_date;
      const bucket = byDay.get(key);
      if (bucket) bucket.push(item);
      else byDay.set(key, [item]);
    }
    const groups = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { overdueItems: overdue, dayGroups: groups };
  }, [items, flat]);

  if (flat) {
    return (
      <ul className="space-y-1">
        {items.map((item) => (
          <PaymentTimelineRow
            key={item.id}
            item={item}
            personIds={byPayment.get(paymentIdForItem(item)) ?? []}
            inOverdue={false}
            onSelect={onSelect}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      {overdueItems.length > 0 ? (
        <section className="rounded-xl border border-neg/25 bg-neg-soft p-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-neg">
            <ExclamationTriangleIcon className="size-4" />
            Prekoračeno
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs font-bold tracking-[-0.01em] tabular-nums">
                <Amount value={overdueItems.reduce((sum, i) => sum + i.amount, 0)} />
              </span>
              <span className="rounded-full bg-neg/15 px-2 py-[3px] text-[10.5px] font-bold tabular-nums">
                {overdueItems.length}
              </span>
            </span>
          </h2>
          <ul className="mt-1.5 space-y-0.5">
            {overdueItems.map((item) => (
              <PaymentTimelineRow
                key={item.id}
                item={item}
                personIds={byPayment.get(paymentIdForItem(item)) ?? []}
                inOverdue
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {dayGroups.map(([day, dayItems]) => (
        <section key={day}>
          <AgendaDateHeader day={day} today={today} tomorrow={tomorrow} />
          <ul className="mt-2 space-y-1">
            {dayItems.map((item) => (
              <PaymentTimelineRow
                key={item.id}
                item={item}
                personIds={byPayment.get(paymentIdForItem(item)) ?? []}
                inOverdue={false}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
