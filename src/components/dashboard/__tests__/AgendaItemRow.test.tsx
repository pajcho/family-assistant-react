import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import type { AgendaItem } from "@/hooks/useAgenda";
import type { Birthday, Event, Payment } from "@/types/database";

const birthday: Birthday = {
  id: "b1",
  family_id: "f1",
  name: "Ana",
  description: null,
  birth_date: "2018-08-04",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const event: Event = {
  id: "e1",
  family_id: "f1",
  name: "Ročište",
  description: null,
  date: "2026-07-28",
  start_time: "11:00",
  end_time: null,
  notes: null,
  remind_minutes_before: null,
  canceled_at: null,
  cancel_reason: null,
  birthday_id: null,
  reschedule_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const payment: Payment = {
  id: "p1",
  family_id: "f1",
  name: "Infostan",
  description: null,
  amount: 11200,
  currency: "RSD",
  original_amount: null,
  exchange_rate: null,
  due_date: "2026-07-19",
  is_recurring: true,
  recurrence_period: "monthly",
  recurrence_interval: 1,
  remaining_occurrences: null,
  is_paid: false,
  is_paused: false,
  is_variable_amount: false,
  paid_date: null,
  remind_days_before: null,
  activity_id: null,
  event_id: null,
  birthday_id: null,
  category_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const birthdayItem: AgendaItem = { kind: "birthday", date: "2026-08-04", sortKey: 0, birthday };
const paymentItem: AgendaItem = {
  kind: "payment",
  date: "2026-07-19",
  sortKey: 0,
  payment,
  occurrenceDate: "2026-07-19",
  effectiveDate: "2026-07-19",
  personIds: [],
};
const eventItem: AgendaItem = {
  kind: "event",
  date: "2026-07-28",
  sortKey: 0,
  event,
  isAllDay: false,
  personIds: [],
};

/** The row's leading child is the time gutter. */
function gutterOf(row: HTMLElement): HTMLElement {
  return row.firstElementChild as HTMLElement;
}

describe("AgendaItemRow time gutter", () => {
  it.each([
    ["birthday", birthdayItem],
    ["payment", paymentItem],
  ])("drops the empty gutter on phones so a time-less %s starts hard left", (_kind, item) => {
    render(
      <ul>
        <AgendaItemRow item={item} onClick={() => {}} />
      </ul>,
    );

    const gutter = gutterOf(screen.getByRole("button"));
    expect(gutter).toHaveTextContent("");
    expect(gutter.className).toContain("hidden");
    // …but the column returns from `sm` up, where rows still line up.
    expect(gutter.className).toContain("sm:block");
  });

  it("keeps the gutter at every width once it carries a label", () => {
    const { rerender } = render(
      <ul>
        <AgendaItemRow item={eventItem} onClick={() => {}} />
      </ul>,
    );

    expect(gutterOf(screen.getByRole("button"))).toHaveTextContent("11:00");
    expect(gutterOf(screen.getByRole("button")).className).not.toContain("hidden");

    // A payment is time-less everywhere except "Prekoračeno", where the row
    // carries its due date - that label has to survive on phones too.
    rerender(
      <ul>
        <AgendaItemRow item={paymentItem} onClick={() => {}} dateLabel="19. jul" />
      </ul>,
    );
    const gutter = gutterOf(screen.getByRole("button"));
    expect(gutter).toHaveTextContent("19. jul");
    expect(gutter.className).not.toContain("hidden");
  });
});
