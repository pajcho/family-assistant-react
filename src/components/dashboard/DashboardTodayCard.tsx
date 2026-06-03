import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { BanknotesIcon, CalendarIcon, Squares2X2Icon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCENT_ICON, ACCENT_MUTED_ICON } from "@/components/dashboard/DashboardCard";
import { EventDetailDialog } from "@/components/dashboard/EventDetailDialog";
import { PaymentDetailDialog } from "@/components/dashboard/PaymentDetailDialog";
import { BlockActionDialog } from "@/components/activities/BlockActionDialog";
import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { Activity, Event, Payment, Profile } from "@/types/database";
import {
  fallbackColorForProfile,
  getThisWeekStart,
  normalizeTime,
  type ResolvedActivityBlock,
} from "@/utils/activity";
import { srLocale } from "@/utils/date";
import { isEventEnded } from "@/utils/event";
import { useActivities } from "@/hooks/useActivities";
import { useEventsList } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { usePaymentsList } from "@/hooks/usePayments";
import { useWeekActivities } from "@/hooks/useWeekActivities";
import { getDisplayName } from "@/utils/identity";

/**
 * "Danas" dashboard hero — single chronological list combining today's
 * activities, today's events and today-due unpaid payments. Items with a
 * concrete start time come first (sorted ascending), then all-day events,
 * then payments at the very bottom.
 *
 * Clicking a row opens the SAME detail popup that the dedicated feature
 * card uses — activity opens `BlockActionDialog` (with cancel/reschedule
 * actions), event/payment use shared detail dialogs. The "Izmeni" buttons
 * inside payment/event dialogs flow back to the dashboard's existing form
 * state via the `onEditEvent` / `onEditPayment` props (so the dashboard's
 * `PaymentFormDialog` etc. open as expected). For activity edit, we
 * navigate to /activities — that page owns the activity form dialog.
 */
export type DashboardTodayCardProps = {
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
};

type TodayItem =
  | {
      kind: "activity";
      sortKey: number;
      block: ResolvedActivityBlock;
      person: Profile | undefined;
      activity: Activity | undefined;
    }
  | {
      kind: "event";
      sortKey: number;
      event: Event;
      isAllDay: boolean;
      personIds: string[];
    }
  | {
      kind: "payment";
      sortKey: number;
      payment: Payment;
    };

const ALL_DAY_SORT_KEY = 24 * 60 + 1; // After every minute of the day
const PAYMENT_SORT_KEY = ALL_DAY_SORT_KEY + 1; // After all-day events

export function DashboardTodayCard({ onEditEvent, onEditPayment }: DashboardTodayCardProps) {
  const today = format(new Date(), "yyyy-MM-dd");
  const weekStart = useMemo(() => getThisWeekStart(), []);
  const navigate = useNavigate();

  const { blocks, isLoading: activitiesLoading } = useWeekActivities(weekStart);
  const { byId: peopleById } = useFamilyMembers();
  const { byEvent } = useEventParticipants();
  const { data: activities } = useActivities();
  const { data: events, isLoading: eventsLoading } = useEventsList({ from: today, to: today });
  const { data: payments, isLoading: paymentsLoading } = usePaymentsList();

  const activitiesById = useMemo(() => {
    const map = new Map<string, Activity>();
    for (const a of activities ?? []) map.set(a.id, a);
    return map;
  }, [activities]);

  // Per-detail-dialog selection state. Only one is open at a time in
  // practice but each tracks its own piece of data so the dialog stays
  // populated while it animates out.
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<ResolvedActivityBlock | null>(null);

  const items = useMemo<TodayItem[]>(() => {
    const todayActivities: TodayItem[] = blocks
      .filter((b) => {
        if (b.date !== today) return false;
        // Today is for "what's actually happening" — drop cancellations
        // (the termin isn't taking place) and moved-away ghosts (the
        // termin is happening somewhere else today; the moved-here block
        // on that target date is what surfaces here).
        if (b.override?.action === "cancel") return false;
        if (b.override?.movedTo) return false;
        return true;
      })
      .map((block) => ({
        kind: "activity" as const,
        sortKey: timeToMin(block.startTime),
        block,
        person: peopleById.get(block.personId),
        activity: activitiesById.get(block.activityId),
      }));

    const todayEvents: TodayItem[] = (events ?? [])
      .filter((event) => !event.canceled_at)
      .map((event) => {
        const startTime = event.start_time ? normalizeTime(event.start_time) : null;
        return {
          kind: "event" as const,
          sortKey: startTime ? timeToMin(startTime) : ALL_DAY_SORT_KEY,
          event,
          isAllDay: !startTime,
          personIds: byEvent.get(event.id) ?? [],
        };
      });

    // Today-due, unpaid payments. Paused recurring payments are still due
    // on their date; we keep `is_paused` rows out to mirror the payments
    // page's "what's actionable" filter.
    const todayPayments: TodayItem[] = (payments ?? [])
      .filter((p) => p.due_date === today && !p.is_paid && !p.is_paused)
      .map((payment) => ({
        kind: "payment" as const,
        sortKey: PAYMENT_SORT_KEY,
        payment,
      }));

    return [...todayActivities, ...todayEvents, ...todayPayments].sort(
      (a, b) => a.sortKey - b.sortKey,
    );
  }, [blocks, today, events, payments, peopleById, activitiesById, byEvent]);

  const hasItems = items.length > 0;
  const isLoading = activitiesLoading || eventsLoading || paymentsLoading;
  const todayLabel = format(new Date(), "EEEE, d. MMMM", { locale: srLocale });

  return (
    <>
      <Card className="flex h-full flex-col gap-3 py-4">
        <CardHeader className="px-4 pb-0">
          <div className="flex items-center gap-2">
            <Squares2X2Icon
              className={cn("h-5 w-5 shrink-0", hasItems ? ACCENT_ICON.emerald : ACCENT_MUTED_ICON)}
            />
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">
              Danas
              <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-500">
                · {todayLabel}
              </span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col px-4">
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
          ) : hasItems ? (
            <ul className="space-y-1">
              {items.map((item) => (
                <TodayItemRow
                  key={itemKey(item)}
                  item={item}
                  onSelectEvent={setSelectedEvent}
                  onSelectPayment={setSelectedPayment}
                  onSelectBlock={setSelectedBlock}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Slobodan dan — nema aktivnosti, događaja ni plaćanja.
            </p>
          )}

          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <Button asChild variant="outline" size="sm">
              <Link to="/activities">Pogledaj sve</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <EventDetailDialog
        open={!!selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
        event={selectedEvent}
        personIds={selectedEvent ? (byEvent.get(selectedEvent.id) ?? []) : []}
        onEdit={onEditEvent}
      />

      <PaymentDetailDialog
        open={!!selectedPayment}
        onOpenChange={(open) => {
          if (!open) setSelectedPayment(null);
        }}
        payment={selectedPayment}
        onEdit={onEditPayment}
      />

      <BlockActionDialog
        open={!!selectedBlock}
        onOpenChange={(open) => {
          if (!open) setSelectedBlock(null);
        }}
        block={selectedBlock}
        activity={selectedBlock ? activitiesById.get(selectedBlock.activityId) : undefined}
        person={selectedBlock ? peopleById.get(selectedBlock.personId) : undefined}
        // The activity-edit form (with schedule + participants) lives on
        // /activities, not the dashboard. BlockActionDialog already closed
        // itself before this fires; deep-link with ?edit=<id> so that page
        // opens its edit dialog on arrival instead of just landing there.
        onEditActivity={(activity) => {
          void navigate({ to: "/activities", search: { edit: activity.id } });
        }}
      />
    </>
  );
}

function timeToMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function itemKey(item: TodayItem): string {
  switch (item.kind) {
    case "activity":
      return `activity-${item.block.scheduleId}-${item.block.date}`;
    case "event":
      return `event-${item.event.id}`;
    case "payment":
      return `payment-${item.payment.id}`;
  }
}

interface TodayItemRowProps {
  item: TodayItem;
  onSelectEvent: (event: Event) => void;
  onSelectPayment: (payment: Payment) => void;
  onSelectBlock: (block: ResolvedActivityBlock) => void;
}

function TodayItemRow({ item, onSelectEvent, onSelectPayment, onSelectBlock }: TodayItemRowProps) {
  switch (item.kind) {
    case "activity":
      return (
        <ActivityRow
          block={item.block}
          person={item.person}
          activity={item.activity}
          onClick={() => onSelectBlock(item.block)}
        />
      );
    case "event":
      return (
        <EventRow
          event={item.event}
          isAllDay={item.isAllDay}
          personIds={item.personIds}
          onClick={() => onSelectEvent(item.event)}
        />
      );
    case "payment":
      return <PaymentRow payment={item.payment} onClick={() => onSelectPayment(item.payment)} />;
  }
}

/* ------------------------------------------------------------------------- */
/* Row variants                                                              */
/* ------------------------------------------------------------------------- */

/** Common visual frame so every row aligns: 6rem time gutter | indicator | label. */
const ROW_CLASS =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/70";
const TIME_GUTTER_CLASS =
  "w-24 shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400";
/** Match the dim treatment used for ended events on the /events page. */
const PAST_ROW_CLASS = "opacity-50";

function isActivityBlockPast(block: ResolvedActivityBlock, today: string): boolean {
  if (block.date < today) return true;
  if (block.date > today) return false;
  const [h, m] = block.endTime.split(":").map(Number);
  const end = new Date();
  end.setHours(h, m, 0, 0);
  return new Date() >= end;
}

function ActivityRow({
  block,
  person,
  activity,
  onClick,
}: {
  block: ResolvedActivityBlock;
  person: Profile | undefined;
  activity: Activity | undefined;
  onClick: () => void;
}) {
  const color = person?.color ?? fallbackColorForProfile(block.personId);
  const personName = person
    ? getDisplayName({
        firstName: person.first_name,
        lastName: person.last_name,
        email: null,
      }) || "Bez imena"
    : "—";
  const activityName = activity?.name ?? "Aktivnost";
  const today = format(new Date(), "yyyy-MM-dd");
  const isPast = isActivityBlockPast(block, today);

  return (
    <li>
      <button type="button" onClick={onClick} className={cn(ROW_CLASS, isPast && PAST_ROW_CLASS)}>
        <span className={TIME_GUTTER_CLASS}>
          {block.startTime}–{block.endTime}
        </span>
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-gray-900 dark:text-gray-100">{personName}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-gray-700 dark:text-gray-300">{activityName}</span>
        </span>
      </button>
    </li>
  );
}

function EventRow({
  event,
  isAllDay,
  personIds,
  onClick,
}: {
  event: Event;
  isAllDay: boolean;
  personIds: string[];
  onClick: () => void;
}) {
  const startTime = event.start_time ? normalizeTime(event.start_time) : null;
  const endTime = event.end_time ? normalizeTime(event.end_time) : null;
  const timeLabel = isAllDay ? "ceo dan" : endTime ? `${startTime}–${endTime}` : (startTime ?? "");
  const isPast = isEventEnded(event);

  return (
    <li>
      <button type="button" onClick={onClick} className={cn(ROW_CLASS, isPast && PAST_ROW_CLASS)}>
        <span className={TIME_GUTTER_CLASS}>{timeLabel}</span>
        <CalendarIcon className="size-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-gray-900 dark:text-gray-100">{event.name}</span>
          {event.description ? (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="text-gray-700 dark:text-gray-300">{event.description}</span>
            </>
          ) : null}
        </span>
        {personIds.length > 0 ? <MemberBadges personIds={personIds} size="xs" /> : null}
      </button>
    </li>
  );
}

function PaymentRow({ payment, onClick }: { payment: Payment; onClick: () => void }) {
  // Locale-aware integer formatting so amounts read "2.500" not "2500" in
  // Serbian. Currency is always RSD across the app.
  const amountStr = new Intl.NumberFormat("sr-Latn", {
    maximumFractionDigits: 0,
  }).format(payment.amount);

  return (
    <li>
      <button type="button" onClick={onClick} className={ROW_CLASS}>
        <span className={TIME_GUTTER_CLASS}>{/* no time */}</span>
        <BanknotesIcon className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-gray-900 dark:text-gray-100">{payment.name}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-gray-700 dark:text-gray-300">{amountStr} RSD</span>
        </span>
      </button>
    </li>
  );
}
