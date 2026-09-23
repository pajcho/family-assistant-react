import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Payment, Task } from "@/types/database";

// The router is not mounted here: a Link becomes a plain anchor that keeps
// its target visible, so the test can read where each banner points.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    className,
    children,
  }: {
    to: string;
    search?: Record<string, unknown>;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={to} data-search={search ? JSON.stringify(search) : undefined} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn<() => void>(),
}));

// The next-days block draws person dots through this hook, which reaches the
// Supabase client at import time - CI has no env for it.
vi.mock("@/hooks/useFamilyMembers", () => ({
  useFamilyMembers: () => ({ byId: new Map() }),
}));

// Same trap through the row key: the rail imports `agendaItemKey` from the
// agenda hook, and that module fans out to a dozen Supabase-backed hooks. A
// standalone factory (never `importOriginal`) keeps the real module out; the
// types imported below are erased, so they still come from the real file.
vi.mock("@/hooks/useAgenda", () => ({
  agendaItemKey: (item: { kind: string; date: string }) => `${item.kind}:${item.date}`,
}));

import { TodayRail } from "@/components/dashboard/TodayRail";
import type { PaymentAgendaItem, TaskAgendaItem } from "@/hooks/useAgenda";

const today = "2026-09-14";

function paymentItem(id: string, amount: number): PaymentAgendaItem {
  const payment: Payment = {
    created_by_id: null,
    updated_by_id: null,
    id,
    family_id: "f1",
    name: "Infostan",
    description: null,
    amount,
    currency: "RSD",
    original_amount: null,
    exchange_rate: null,
    due_date: "2026-09-01",
    is_recurring: false,
    recurrence_period: null,
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
  return {
    kind: "payment",
    date: "2026-09-01",
    sortKey: 0,
    payment,
    occurrenceDate: "2026-09-01",
    effectiveDate: "2026-09-01",
    personIds: [],
  };
}

function taskItem(id: string): TaskAgendaItem {
  const task: Task = {
    id,
    list_id: null,
    family_id: "f1",
    owner_id: "parent-1",
    scope: "family",
    name: "Platiti Jovani za jaja",
    description: null,
    is_completed: false,
    completed_at: null,
    completed_by_person_id: null,
    due_date: "2026-08-31",
    due_time: null,
    recurrence_period: null,
    recurrence_interval: 1,
    recurrence_weekdays: null,
    recurrence_until: null,
    completion_mode: "shared",
    remind_minutes_before: null,
    remind_days_before: null,
    sort_order: 1,
    category: null,
    category_confidence: null,
    created_by_id: "parent-1",
    updated_by_id: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };
  return {
    kind: "task",
    date: "2026-08-31",
    sortKey: 0,
    task,
    occurrenceDate: "2026-08-31",
    dueTime: null,
    assigneeIds: [],
    isDone: false,
    missed: false,
  };
}

function renderRail(props: {
  overduePayments?: PaymentAgendaItem[];
  overdueTasks?: TaskAgendaItem[];
}) {
  return render(
    <TodayRail
      today={today}
      overduePayments={props.overduePayments ?? []}
      overdueTasks={props.overdueTasks ?? []}
      upcoming={[]}
      countByDay={new Map()}
      filterActive={false}
    />,
  );
}

describe("TodayRail overdue banners", () => {
  it("shows a late task as a task, linked to the Kasni cut, with no money on it", () => {
    renderRail({ overdueTasks: [taskItem("t1")] });

    const banner = screen.getByRole("link", { name: /Kasni · 1 zadatak/ });
    expect(banner).toHaveAttribute("href", "/tasks/late");
    expect(screen.queryByText(/Prekoračeno/)).not.toBeInTheDocument();
    expect(screen.queryByText("RSD")).not.toBeInTheDocument();
  });

  it("keeps money and work apart: one banner per kind, each with its own count", () => {
    renderRail({
      overduePayments: [paymentItem("p1", 300), paymentItem("p2", 200)],
      overdueTasks: [taskItem("t1")],
    });

    const money = screen.getByRole("link", { name: /Prekoračeno · 2 plaćanja/ });
    expect(money).toHaveAttribute("href", "/money");
    expect(money).toHaveAttribute("data-search", JSON.stringify({ tab: "payments" }));
    expect(within(money).getByText("500")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Kasni · 1 zadatak/ })).toHaveAttribute(
      "href",
      "/tasks/late",
    );
  });
});
