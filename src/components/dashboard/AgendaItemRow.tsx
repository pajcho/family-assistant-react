import { format } from "date-fns";
import { BanknotesIcon, CakeIcon, CalendarIcon } from "@heroicons/react/24/outline";

import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { AgendaItem } from "@/hooks/useAgenda";
import type { Activity, Birthday, Event, Payment, Profile } from "@/types/database";
import {
  fallbackColorForProfile,
  normalizeTime,
  type ResolvedActivityBlock,
} from "@/utils/activity";
import { currentAge } from "@/utils/birthday";
import { isEventEnded } from "@/utils/event";
import { getDisplayName } from "@/utils/identity";
import { isUpcomingPaymentOccurrence } from "@/utils/payment";

/**
 * One agenda row — the discriminated-union renderer shared by the "Danas" and
 * "Uskoro" tabs. Lifted (activity / event / payment variants verbatim) out of
 * the old `DashboardTodayCard`, plus a birthday variant. Every variant uses the
 * same frame — a fixed time gutter, a type indicator, then a truncating label —
 * so rows line up whatever their kind. Clicking a row bubbles up via `onClick`
 * (the tab opens the matching detail dialog).
 */

/** Common visual frame so every row aligns: time gutter | indicator | label. */
const ROW_CLASS =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/70";
const TIME_GUTTER_CLASS =
  "w-24 shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400";
/** Match the dim treatment used for ended events on the /events page. */
const PAST_ROW_CLASS = "opacity-50";

export function AgendaItemRow({
  item,
  onClick,
  dateLabel,
}: {
  item: AgendaItem;
  onClick: () => void;
  /** Optional label for the (otherwise empty) payment time gutter — e.g. the
   *  due date in the "Prekoračeno" section. */
  dateLabel?: string;
}) {
  switch (item.kind) {
    case "activity":
      return (
        <ActivityRow
          block={item.block}
          person={item.person}
          activity={item.activity}
          onClick={onClick}
        />
      );
    case "event":
      return (
        <EventRow
          event={item.event}
          isAllDay={item.isAllDay}
          personIds={item.personIds}
          onClick={onClick}
        />
      );
    case "payment":
      // A payment occurrence that ISN'T the series' live one (keyed on
      // payment.due_date) is a future repetition ("nadolazeće") — only the Uskoro
      // list surfaces those. It's shown read-only there: no detail dialog, so
      // none of its actions (Pomeri / Otkaži / Označi kao plaćeno / Izmeni) can
      // fire before it becomes the current due. The live occurrence stays
      // actionable even when its due date is still in the future (e.g. due
      // tomorrow), matching the payments page.
      return (
        <PaymentRow
          payment={item.payment}
          personIds={item.personIds}
          onClick={onClick}
          dateLabel={dateLabel}
          upcoming={isUpcomingPaymentOccurrence(item)}
        />
      );
    case "birthday":
      return <BirthdayRow birthday={item.birthday} onClick={onClick} />;
  }
}

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
        <span className="min-w-0 truncate">
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
        <span className="min-w-0 truncate">
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

function PaymentRow({
  payment,
  personIds,
  onClick,
  dateLabel,
  upcoming = false,
}: {
  payment: Payment;
  personIds: string[];
  onClick: () => void;
  dateLabel?: string;
  /** Not-yet-due occurrence (Uskoro list): rendered read-only with a
   *  "Nadolazeće" tag instead of a tappable row, so no action can be taken on
   *  it before its due date. */
  upcoming?: boolean;
}) {
  // Locale-aware integer formatting so amounts read "2.500" not "2500" in
  // Serbian. Currency is always RSD across the app.
  const amountStr = new Intl.NumberFormat("sr-Latn", {
    maximumFractionDigits: 0,
  }).format(payment.amount);

  const content = (
    <>
      <span className={TIME_GUTTER_CLASS}>{dateLabel ?? ""}</span>
      <BanknotesIcon className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
      <span className="min-w-0 truncate">
        <span className="font-medium text-gray-900 dark:text-gray-100">{payment.name}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="text-gray-700 dark:text-gray-300">{amountStr} RSD</span>
      </span>
      {upcoming ? (
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:bg-gray-700 dark:text-gray-400">
          Nadolazeće
        </span>
      ) : null}
      {personIds.length > 0 ? <MemberBadges personIds={personIds} size="xs" /> : null}
    </>
  );

  // Not yet due → static row (no button), so the detail dialog never opens.
  if (upcoming) {
    return (
      <li>
        <div
          className={cn(
            ROW_CLASS,
            "cursor-default opacity-60 hover:bg-transparent dark:hover:bg-transparent",
          )}
        >
          {content}
        </div>
      </li>
    );
  }

  return (
    <li>
      <button type="button" onClick={onClick} className={ROW_CLASS}>
        {content}
      </button>
    </li>
  );
}

function BirthdayRow({ birthday, onClick }: { birthday: Birthday; onClick: () => void }) {
  // Next age = the birthday they're about to have. Rendered as an ordinal
  // ("8. rođendan") to sidestep Serbian plural agreement on "godina".
  const nextAge = currentAge(birthday.birth_date) + 1;

  return (
    <li>
      <button type="button" onClick={onClick} className={ROW_CLASS}>
        <span className={TIME_GUTTER_CLASS}>{/* no time */}</span>
        <CakeIcon className="size-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
        <span className="min-w-0 truncate">
          <span className="font-medium text-gray-900 dark:text-gray-100">{birthday.name}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-gray-700 dark:text-gray-300">{nextAge}. rođendan</span>
        </span>
      </button>
    </li>
  );
}
