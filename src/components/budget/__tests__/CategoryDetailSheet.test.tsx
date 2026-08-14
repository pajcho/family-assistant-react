import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CategoryDetailSheet,
  type CategoryDetailRow,
} from "@/components/budget/CategoryDetailSheet";
import type { Expense } from "@/types/database";

vi.mock("@/hooks/useExpenses", () => ({
  useExpenses: () => ({ expenses: [], isLoading: false }),
}));

vi.mock("@/hooks/useExpenseCategories", () => ({
  useUpdateExpenseCategory: () => ({ mutateAsync: vi.fn<() => Promise<void>>(), isPending: false }),
}));

// The member badge on a listed expense self-fetches the roster, and
// `useFamilyMembers` reaches `lib/supabase` at import time - which throws on CI,
// where the VITE_SUPABASE_* vars don't exist. Same stub the agenda-row suite uses.
// `DetailAuditLine` resolves author names through `useFamilyMembers`, which
// is another route to the same client. Mocked rather than stubbed out, so the
// line itself still renders here.
vi.mock("@/hooks/useFamilyMembers", () => ({ useFamilyMembers: () => ({ byId: new Map() }) }));

// `AuditTimeline` reaches Supabase through `useAuditLog`, and CI has no
// VITE_SUPABASE_* - stubbing the module cuts that chain in one line, the same
// way the hooks above are cut. See plans/018-audit-log.md.
vi.mock("@/components/common/AuditTimeline", () => ({ AuditTimeline: () => null }));

vi.mock("@/components/common/MemberBadges", () => ({
  MemberBadges: () => null,
}));

// Link resolution reaches useActivities -> useProfile -> useAuth; stub it to the
// one link this file cares about (the row linked to activity "act-1").
vi.mock("@/hooks/usePaymentLinks", () => ({
  usePaymentLinkTargets: () => ({
    targetFor: (row: { activity_id: string | null }) =>
      row.activity_id === "act-1" ? { kind: "activity", id: "act-1", name: "Klavir" } : null,
  }),
}));

const namirnice: CategoryDetailRow = {
  categoryId: "cat-1",
  name: "Namirnice",
  color: "#3b82f6",
  icon: "shopping-cart",
};

const bezKategorije: CategoryDetailRow = {
  categoryId: null,
  name: "Bez kategorije",
  color: "#94a3b8",
  icon: "tag",
};

const struja = {
  id: "exp-1",
  category_id: "cat-1",
  amount: 7715.32,
  currency: "RSD",
  original_amount: null,
  spent_on: "2026-08-15",
  merchant: null,
  note: "Struja",
  source: "manual",
  payment_id: null,
  receipt_id: null,
  receipt_url: null,
  person_id: null,
} as unknown as Expense;

function renderSheet(props: Partial<Parameters<typeof CategoryDetailSheet>[0]> = {}) {
  return render(
    <CategoryDetailSheet
      open
      onOpenChange={vi.fn<(open: boolean) => void>()}
      row={namirnice}
      category={null}
      month="2026-08"
      expenses={[]}
      {...props}
    />,
  );
}

describe("CategoryDetailSheet", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hands the drilled-into category to the expense form", () => {
    const onAddExpense = vi.fn<(categoryId: string) => void>();
    renderSheet({ onAddExpense });

    fireEvent.click(screen.getByRole("button", { name: /Dodaj trošak/ }));

    expect(onAddExpense).toHaveBeenCalledWith("cat-1");
  });

  it("offers no add action for the 'Bez kategorije' bucket", () => {
    renderSheet({ row: bezKategorije, onAddExpense: vi.fn<(categoryId: string) => void>() });

    expect(screen.queryByRole("button", { name: /Dodaj trošak/ })).toBeNull();
  });

  it("opens a listed expense from the category list", () => {
    const onOpenExpense = vi.fn<(expense: Expense) => void>();
    renderSheet({ expenses: [struja], onOpenExpense });

    fireEvent.click(screen.getByRole("button", { name: /Struja/ }));

    expect(onOpenExpense).toHaveBeenCalledWith(struja);
  });

  it("names a row by its note and keeps the leftover identifier on the second line", () => {
    // The category is deliberately NOT a fallback here - it would title every
    // row "Režije" inside the Režije drill-down.
    renderSheet({
      expenses: [{ ...struja, note: null, activity_id: "act-1" } as Expense, struja],
    });

    expect(screen.getByText("Struja")).toBeTruthy();
    expect(screen.getByText("Klavir")).toBeTruthy();
    expect(screen.queryByText("Trošak")).toBeNull();
  });

  it("leaves the list unclickable when the page offers no expense detail", () => {
    renderSheet({ expenses: [struja] });

    expect(screen.getByText("Struja")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Struja/ })).toBeNull();
  });

  it("closes the overlay while the expense form owns the screen", () => {
    renderSheet({ onAddExpense: vi.fn<(categoryId: string) => void>(), hidden: true });

    expect(screen.queryByText("Namirnice")).toBeNull();
  });
});
