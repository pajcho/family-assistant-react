import * as React from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  BanknotesIcon,
  CalendarIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCENT_ICON, ACCENT_MUTED_ICON } from "@/components/dashboard/DashboardCard";
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
 * The other dashboard cards (Događaji, Plaćanja) intentionally still show
 * today's rows too — this widget is for the "what's the family doing
 * today" quick scan, not a replacement for per-feature navigation.
 *
 * Rows link out to the source page (/activities, /events, /payments) so
 * clicking is a fast jump to the feature, not a modal.
 */
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
    }
  | {
      kind: "payment";
      sortKey: number;
      payment: Payment;
    };

const ALL_DAY_SORT_KEY = 24 * 60 + 1; // After every minute of the day
const PAYMENT_SORT_KEY = ALL_DAY_SORT_KEY + 1; // After all-day events

export function DashboardTodayCard() {
  const today = format(new Date(), "yyyy-MM-dd");
  const weekStart = React.useMemo(() => getThisWeekStart(), []);

  const { blocks, isLoading: activitiesLoading } = useWeekActivities(weekStart);
  const { byId: peopleById } = useFamilyMembers();
  const { data: activities } = useActivities();
  const { data: events, isLoading: eventsLoading } = useEventsList({ from: today, to: today });
  const { data: payments, isLoading: paymentsLoading } = usePaymentsList();

  const activitiesById = React.useMemo(() => {
    const map = new Map<string, Activity>();
    for (const a of activities ?? []) map.set(a.id, a);
    return map;
  }, [activities]);

  const items = React.useMemo<TodayItem[]>(() => {
    const todayActivities: TodayItem[] = blocks
      .filter((b) => b.date === today)
      .map((block) => ({
        kind: "activity" as const,
        sortKey: timeToMin(block.startTime),
        block,
        person: peopleById.get(block.personId),
        activity: activitiesById.get(block.activityId),
      }));

    const todayEvents: TodayItem[] = (events ?? []).map((event) => {
      const startTime = event.start_time ? normalizeTime(event.start_time) : null;
      return {
        kind: "event" as const,
        sortKey: startTime ? timeToMin(startTime) : ALL_DAY_SORT_KEY,
        event,
        isAllDay: !startTime,
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
  }, [blocks, today, events, payments, peopleById, activitiesById]);

  const hasItems = items.length > 0;
  const isLoading = activitiesLoading || eventsLoading || paymentsLoading;
  const todayLabel = format(new Date(), "EEEE, d. MMMM", { locale: srLocale });

  return (
    <Card className="flex h-full flex-col gap-3 py-4">
      <CardHeader className="px-4 pb-0">
        <div className="flex items-center gap-2">
          <Squares2X2Icon
            className={cn(
              "h-5 w-5 shrink-0",
              hasItems ? ACCENT_ICON.emerald : ACCENT_MUTED_ICON,
            )}
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
              <TodayItemRow key={itemKey(item)} item={item} />
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
  );
}

function timeToMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function itemKey(item: TodayItem): string {
  switch (item.kind) {
    case "activity":
      return `activity-${item.block.scheduleId}`;
    case "event":
      return `event-${item.event.id}`;
    case "payment":
      return `payment-${item.payment.id}`;
  }
}

interface TodayItemRowProps {
  item: TodayItem;
}

function TodayItemRow({ item }: TodayItemRowProps) {
  switch (item.kind) {
    case "activity":
      return <ActivityRow block={item.block} person={item.person} activity={item.activity} />;
    case "event":
      return <EventRow event={item.event} isAllDay={item.isAllDay} />;
    case "payment":
      return <PaymentRow payment={item.payment} />;
  }
}

/* ------------------------------------------------------------------------- */
/* Row variants                                                              */
/* ------------------------------------------------------------------------- */

/** Common visual frame so every row aligns: 6rem time gutter | indicator | label. */
const ROW_CLASS =
  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/70";
const TIME_GUTTER_CLASS =
  "w-24 shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400";
/** Match the dim treatment used for ended events on the /events page. */
const PAST_ROW_CLASS = "opacity-50";

/**
 * True if an activity block has already finished — its end_time has passed
 * on today's date. Mirrors `isEventEnded` but for the resolved block shape.
 */
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
}: {
  block: ResolvedActivityBlock;
  person: Profile | undefined;
  activity: Activity | undefined;
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
      <Link to="/activities" className={cn(ROW_CLASS, isPast && PAST_ROW_CLASS)}>
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
      </Link>
    </li>
  );
}

function EventRow({ event, isAllDay }: { event: Event; isAllDay: boolean }) {
  const startTime = event.start_time ? normalizeTime(event.start_time) : null;
  const endTime = event.end_time ? normalizeTime(event.end_time) : null;
  const timeLabel = isAllDay
    ? "ceo dan"
    : endTime
      ? `${startTime}–${endTime}`
      : (startTime ?? "");
  const isPast = isEventEnded(event);

  return (
    <li>
      <Link to="/events" className={cn(ROW_CLASS, isPast && PAST_ROW_CLASS)}>
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
      </Link>
    </li>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  // Locale-aware integer formatting so amounts read "2.500" not "2500" in
  // Serbian. Currency is always RSD across the app.
  const amountStr = new Intl.NumberFormat("sr-Latn", {
    maximumFractionDigits: 0,
  }).format(payment.amount);

  return (
    <li>
      <Link to="/payments" className={ROW_CLASS}>
        <span className={TIME_GUTTER_CLASS}>{/* no time */}</span>
        <BanknotesIcon className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-gray-900 dark:text-gray-100">{payment.name}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-gray-700 dark:text-gray-300">{amountStr} RSD</span>
        </span>
      </Link>
    </li>
  );
}
