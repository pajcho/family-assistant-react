import { format } from "date-fns";

import { Amount, AmountOriginal } from "@/components/common/Amount";
import {
  ItemCard,
  ItemMain,
  ItemMeta,
  ItemSide,
  ItemTile,
  ItemTime,
  ItemTitle,
  PersonDot,
} from "@/components/common/ItemCard";
import { MemberBadges } from "@/components/common/MemberBadges";
import { useMemberEmoji } from "@/hooks/useMemberAvatarStyle";
import { Pill } from "@/components/common/Pill";
import { AGENDA_KIND_META } from "@/components/dashboard/agendaKindMeta";
import type { AgendaItem } from "@/hooks/useAgenda";
import type {
  Activity,
  Birthday,
  ExternalCalendarEvent,
  Payment,
  Profile,
  RecurrencePeriod,
} from "@/types/database";
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
 * One agenda row - the discriminated-union renderer shared by "Danas",
 * "Kalendar › Agenda" and the overdue block.
 *
 * Redizajn 2.0 turned the row from a dense one-liner with a leading time gutter
 * into the shared `.kcard`: a glyph tile on the left says WHAT it is at a
 * glance, the middle column carries title + one meta line, and the trailing
 * column carries the time or the amount. Clicking bubbles up via `onClick` (the
 * screen opens the matching detail dialog).
 */

export function AgendaItemRow({
  item,
  onClick,
  dateLabel,
}: {
  item: AgendaItem;
  onClick: () => void;
  /** Extra meta for a time-less payment row - e.g. the due date when overdue. */
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
      return <EventRow item={item} onClick={onClick} />;
    case "payment":
      // A payment occurrence that ISN'T the series' live one (keyed on
      // payment.due_date) is a future repetition - only the
      // agenda list surfaces those. It's shown read-only there: no detail
      // dialog, so none of its actions (reschedule / cancel / mark paid /
      // Izmeni) can fire before it becomes the current due. The live occurrence
      // stays actionable even when its due date is still in the future (e.g.
      // due tomorrow), matching the payments page.
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
    case "external":
      return (
        <ExternalEventRow
          event={item.event}
          isAllDay={item.isAllDay}
          personIds={item.personIds}
          onClick={onClick}
        />
      );
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
  const memberEmoji = useMemberEmoji();
  const color = person?.color ?? fallbackColorForProfile(block.personId);
  const personName = person
    ? getDisplayName({
        firstName: person.first_name,
        lastName: person.last_name,
        email: null,
      }) || "Bez imena"
    : "-";
  const activityName = activity?.name ?? "Aktivnost";
  const today = format(new Date(), "yyyy-MM-dd");
  const isPast = isActivityBlockPast(block, today);

  return (
    <li>
      <ItemCard onClick={onClick} dimmed={isPast}>
        <ItemTile icon={AGENDA_KIND_META.activity.icon} color={color} />
        <ItemMain>
          <ItemTitle>
            <span className="min-w-0 truncate">{activityName}</span>
            <PersonDot color={color} emoji={memberEmoji(person, block.personId)} />
          </ItemTitle>
          <ItemMeta>
            {block.startTime}-{block.endTime} · {personName}
          </ItemMeta>
        </ItemMain>
        <ItemSide>
          <ItemTime>{block.startTime}</ItemTime>
        </ItemSide>
      </ItemCard>
    </li>
  );
}

function EventRow({
  item,
  onClick,
}: {
  item: Extract<AgendaItem, { kind: "event" }>;
  onClick: () => void;
}) {
  const { event, personIds } = item;
  // Per-day slice times: a multi-day span shows "od 09:00" on its first day,
  // an all-day label through the middle and an end time on its last (mirrors how the
  // expanded Google events read); single-day rows keep the old labels.
  const isMulti = item.totalDays > 1;
  // Trailing column = the short, scannable "when". The meta line only repeats
  // the time when it says MORE than that (a full range).
  const timeLabel = item.startTime
    ? isMulti && !item.endTime
      ? `od ${item.startTime}`
      : item.startTime
    : item.endTime
      ? `do ${item.endTime}`
      : "ceo dan";
  const metaTime = item.startTime && item.endTime ? `${item.startTime}-${item.endTime}` : null;
  const isPast = isEventEnded(event);

  return (
    <li>
      <ItemCard onClick={onClick} dimmed={isPast}>
        <ItemTile icon={AGENDA_KIND_META.event.icon} tone="info" />
        <ItemMain>
          <ItemTitle>
            <span className="min-w-0 truncate">{event.name}</span>
            {isMulti ? (
              <Pill>
                Dan {item.dayIndex}/{item.totalDays}
              </Pill>
            ) : null}
          </ItemTitle>
          <ItemMeta>
            {metaTime || event.description ? (
              <span className="min-w-0 truncate">
                {[metaTime, event.description].filter(Boolean).join(" · ")}
              </span>
            ) : null}
            {personIds.length > 0 ? <MemberBadges personIds={personIds} size="xs" /> : null}
          </ItemMeta>
        </ItemMain>
        <ItemSide>
          <ItemTime>{timeLabel}</ItemTime>
        </ItemSide>
      </ItemCard>
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
  /** Not-yet-due occurrence: rendered read-only with an upcoming tag instead
   *  of a tappable row, so no action can be taken before its due date. */
  upcoming?: boolean;
}) {
  const recurrence =
    payment.is_recurring && payment.recurrence_period
      ? RECURRENCE_LABEL[payment.recurrence_period]
      : null;
  const meta = [
    dateLabel ? `dospelo ${dateLabel}` : null,
    recurrence,
    payment.is_variable_amount ? "promenljiv iznos" : null,
  ].filter(Boolean);

  const content = (
    <>
      <ItemTile
        icon={AGENDA_KIND_META.payment.icon}
        tone={dateLabel ? "neg" : AGENDA_KIND_META.payment.tone}
      />
      <ItemMain>
        <ItemTitle>
          <span className="min-w-0 truncate">{payment.name}</span>
          {upcoming ? <Pill tone="muted">Nadolazeće</Pill> : null}
        </ItemTitle>
        <ItemMeta>
          {meta.length > 0 ? <span className="min-w-0 truncate">{meta.join(" · ")}</span> : null}
          {personIds.length > 0 ? <MemberBadges personIds={personIds} size="xs" /> : null}
        </ItemMeta>
      </ItemMain>
      <ItemSide>
        <span className="text-[15px] font-bold tracking-[-0.01em] tabular-nums">
          <Amount value={payment.amount} round />
        </span>
        <AmountOriginal
          amount={payment.original_amount}
          currency={payment.currency}
          parens
          className="text-[10.5px] font-semibold text-muted-foreground"
        />
      </ItemSide>
    </>
  );

  // Not yet due → static row (no button), so the detail dialog never opens.
  return (
    <li>
      {upcoming ? (
        <ItemCard dimmed>{content}</ItemCard>
      ) : (
        <ItemCard onClick={onClick}>{content}</ItemCard>
      )}
    </li>
  );
}

/** Recurrence in the one-line meta - lowercase forms of RECURRENCE_OPTIONS. */
const RECURRENCE_LABEL: Record<RecurrencePeriod, string | null> = {
  weekly: "nedeljno",
  monthly: "mesečno",
  limited: "ograničeno",
  // A one-off carries no repetition note - the due date already says it all.
  "one-time": null,
};

function BirthdayRow({ birthday, onClick }: { birthday: Birthday; onClick: () => void }) {
  // Next age = the birthday they're about to have. Rendered as an ordinal
  // (an ordinal "Nth birthday") to sidestep Serbian plural agreement on "godina".
  const nextAge = currentAge(birthday.birth_date) + 1;

  return (
    <li>
      <ItemCard onClick={onClick}>
        <ItemTile icon={AGENDA_KIND_META.birthday.icon} tone="pos" />
        <ItemMain>
          <ItemTitle>
            <span className="min-w-0 truncate">{birthday.name}</span>
          </ItemTitle>
          <ItemMeta>
            <span className="min-w-0 truncate">
              {nextAge}. rođendan
              {birthday.description ? ` · ${birthday.description}` : ""}
            </span>
          </ItemMeta>
        </ItemMain>
      </ItemCard>
    </li>
  );
}

/** Past once its end (or start, if no end) has elapsed; all-day past after its day. */
function isExternalEventPast(event: ExternalCalendarEvent): boolean {
  if (event.is_all_day || !event.start_at) {
    return event.local_date < format(new Date(), "yyyy-MM-dd");
  }
  return new Date(event.end_at ?? event.start_at) < new Date();
}

function ExternalEventRow({
  event,
  isAllDay,
  personIds,
  onClick,
}: {
  event: ExternalCalendarEvent;
  isAllDay: boolean;
  personIds: string[];
  onClick: () => void;
}) {
  const startTime = event.start_time ? normalizeTime(event.start_time) : null;
  const endTime = event.end_time ? normalizeTime(event.end_time) : null;
  const timeLabel = isAllDay ? "ceo dan" : (startTime ?? "");
  const metaTime = !isAllDay && startTime && endTime ? `${startTime}-${endTime}` : null;
  const isPast = isExternalEventPast(event);

  return (
    <li>
      <ItemCard onClick={onClick} dimmed={isPast}>
        <ItemTile
          icon={AGENDA_KIND_META.external.icon}
          tone="info"
          color={event.color ?? undefined}
        />
        <ItemMain>
          <ItemTitle>
            <span className="min-w-0 truncate">{event.title ?? "(bez naslova)"}</span>
            <Pill tone="info">Google</Pill>
          </ItemTitle>
          <ItemMeta>
            {metaTime || event.location ? (
              <span className="min-w-0 truncate">
                {[metaTime, event.location].filter(Boolean).join(" · ")}
              </span>
            ) : null}
            {personIds.length > 0 ? <MemberBadges personIds={personIds} size="xs" /> : null}
          </ItemMeta>
        </ItemMain>
        <ItemSide>
          <ItemTime>{timeLabel}</ItemTime>
        </ItemSide>
      </ItemCard>
    </li>
  );
}
