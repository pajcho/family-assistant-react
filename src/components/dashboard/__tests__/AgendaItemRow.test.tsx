import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The rows below carry no participants, but the import alone would pull in
// `useFamilyMembers` → the Supabase client, which throws without env vars.
vi.mock("@/components/common/MemberBadges", () => ({
  MemberBadges: () => null,
}));

// Same trap, second door: the row asks `useMemberEmoji` how to draw a person,
// and that hook reaches the Supabase client at import time. Mocked as a
// standalone factory (never `importOriginal`, which would pull the real module
// in anyway) returning "no emoji", so rows render the colour dot.
vi.mock("@/hooks/useMemberAvatarStyle", () => ({
  useMemberEmoji: () => () => undefined,
  useMemberAvatarStyleValue: () => "initials",
}));

// Third and fourth doors, opened when the agenda grew a task row: `TaskRow`
// resolves its own completion state and its list name, so it imports the
// profile, tasks and occurrence hooks, and all three reach the Supabase client
// at import time. The rows exercised below are birthdays, events and payments -
// task rendering has its own suite in components/tasks/__tests__/TaskRow.test.tsx
// - so these are stubbed rather than the row being stubbed out wholesale, which
// would stop this file from proving AgendaItemRow still routes a task at all.
vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ profile: null, familyId: null, isLoading: false }),
}));
vi.mock("@/hooks/useTasks", () => ({
  useListsWithTasks: () => ({ data: [], isLoading: false }),
  useToggleTask: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("@/hooks/useTaskOccurrences", () => ({
  useTaskOccurrenceRows: () => ({ occurrences: [], byKey: new Map(), isLoading: false }),
}));

import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import type { AgendaItem } from "@/hooks/useAgenda";
import type { Activity, Birthday, Event, Payment } from "@/types/database";
import type { ResolvedActivityBlock } from "@/utils/activity";

const birthday: Birthday = {
  created_by_id: null,
  updated_by_id: null,
  id: "b1",
  family_id: "f1",
  name: "Ana",
  description: null,
  birth_date: "2018-08-04",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const event: Event = {
  created_by_id: null,
  updated_by_id: null,
  id: "e1",
  family_id: "f1",
  name: "Ročište",
  description: null,
  date: "2026-07-28",
  end_date: null,
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
  created_by_id: null,
  updated_by_id: null,
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
  startTime: "11:00",
  endTime: null,
  dayIndex: 1,
  totalDays: 1,
  canceled: false,
  personIds: [],
};

function renderRow(item: AgendaItem, dateLabel?: string) {
  render(
    <ul>
      <AgendaItemRow item={item} onClick={() => {}} dateLabel={dateLabel} />
    </ul>,
  );
  return screen.getByRole("button");
}

describe("AgendaItemRow time column", () => {
  it("shows a timed event's start time", () => {
    expect(renderRow(eventItem)).toHaveTextContent("11:00");
  });

  it.each([
    ["birthday", birthdayItem],
    ["payment", paymentItem],
  ])("renders a time-less %s without a clock", (_kind, item) => {
    // Time-less kinds keep the trailing column for their amount (payments) or
    // drop it entirely (birthdays) - either way no HH:mm is invented.
    expect(renderRow(item).textContent ?? "").not.toMatch(/\d{2}:\d{2}/);
  });

  it("carries the due date in the meta line when 'Prekoračeno' passes one", () => {
    // A payment is date-less everywhere except the overdue section, which hands
    // the row its due date so you can tell how late it is.
    expect(renderRow(paymentItem, "19. jul")).toHaveTextContent("dospelo 19. jul");
  });

  it("annotates a recurring payment with its period", () => {
    expect(renderRow(paymentItem)).toHaveTextContent("mesečno");
  });
});

describe("AgendaItemRow activity rows", () => {
  const block: ResolvedActivityBlock = {
    scheduleId: "s1",
    activityId: "a1",
    personId: "p1",
    date: "2026-07-28",
    dayOfWeek: 1,
    startTime: "16:00",
    endTime: "17:00",
    weekPattern: "every",
    recurrenceIntervalWeeks: 1,
  };
  const klavir = {
    id: "a1",
    family_id: "f1",
    name: "Klavir",
    description: "Muzička škola, sala 3",
  } as Activity;
  const activityItem: AgendaItem = {
    kind: "activity",
    date: "2026-07-28",
    sortKey: 0,
    block,
    activity: klavir,
    person: undefined,
    canceled: false,
  };

  it("reads span, then description, the same second line Danas prints", () => {
    // The two screens showing one activity differently is the bug this shape
    // fixes - keep them writing the same sentence.
    expect(renderRow(activityItem)).toHaveTextContent("16:00-17:00 · Muzička škola, sala 3");
  });

  it("keeps the start time in the trailing column", () => {
    expect(renderRow(activityItem)).toHaveTextContent("16:00");
  });

  it("says nothing about the description when the activity has none", () => {
    const bare: AgendaItem = {
      ...activityItem,
      activity: { ...klavir, description: null } as Activity,
    };
    const row = renderRow(bare);
    expect(row).toHaveTextContent("16:00-17:00");
    expect(row.textContent).not.toContain("·");
  });
});

describe("AgendaItemRow multi-day event slices", () => {
  const multiEvent: Event = {
    ...event,
    id: "e2",
    name: "Odmor",
    date: "2026-07-27",
    end_date: "2026-07-29",
    start_time: "09:00",
    end_time: "15:00",
  };
  const sliceBase = {
    kind: "event" as const,
    event: multiEvent,
    sortKey: 0,
    personIds: [] as string[],
    canceled: false,
  };

  it("labels the first day 'od HH:mm' with its span position", () => {
    const row = renderRow({
      ...sliceBase,
      date: "2026-07-27",
      isAllDay: false,
      startTime: "09:00",
      endTime: null,
      dayIndex: 1,
      totalDays: 3,
    });
    expect(row).toHaveTextContent("od 09:00");
    expect(row).toHaveTextContent("Dan 1/3");
  });

  it("labels middle days 'ceo dan'", () => {
    const row = renderRow({
      ...sliceBase,
      date: "2026-07-28",
      isAllDay: true,
      startTime: null,
      endTime: null,
      dayIndex: 2,
      totalDays: 3,
    });
    expect(row).toHaveTextContent("ceo dan");
    expect(row).toHaveTextContent("Dan 2/3");
  });

  it("labels the last day 'do HH:mm'", () => {
    const row = renderRow({
      ...sliceBase,
      date: "2026-07-29",
      isAllDay: true,
      startTime: null,
      endTime: "15:00",
      dayIndex: 3,
      totalDays: 3,
    });
    expect(row).toHaveTextContent("do 15:00");
    expect(row).toHaveTextContent("Dan 3/3");
  });
});
