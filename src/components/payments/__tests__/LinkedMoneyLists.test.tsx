import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  LinkedExpensesList,
  LinkedPaymentsList,
  expenseRowTitle,
} from "@/components/payments/LinkedPaymentsList";
import type { Expense, Payment } from "@/types/database";

const payment = {
  id: "pay-1",
  name: "Članarina - plivanje",
  amount: 4000,
  currency: "RSD",
  original_amount: null,
  due_date: "2026-08-10",
  recurrence_period: "monthly",
  recurrence_interval: 1,
  is_paid: false,
  is_paused: false,
} as unknown as Payment;

const expense = {
  id: "exp-1",
  amount: 2500,
  currency: "RSD",
  original_amount: null,
  spent_on: "2026-08-01",
  merchant: null,
  note: "Oprema za trening",
  source: "manual",
} as unknown as Expense;

describe("LinkedPaymentsList", () => {
  it("stays static without onSelect", () => {
    render(<LinkedPaymentsList payments={[payment]} />);
    expect(screen.getByText("Članarina - plivanje")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("turns rows into buttons that report the payment", () => {
    const onSelect = vi.fn<(p: Payment) => void>();
    render(<LinkedPaymentsList payments={[payment]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Detalji plaćanja Članarina - plivanje" }));
    expect(onSelect).toHaveBeenCalledWith(payment);
  });

  it("renders nothing while empty", () => {
    const { container } = render(<LinkedPaymentsList payments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LinkedExpensesList", () => {
  it("titles rows by note, then merchant, then a generic label", () => {
    expect(expenseRowTitle({ ...expense, merchant: "Maxi" } as Expense)).toBe("Oprema za trening");
    expect(expenseRowTitle(expense)).toBe("Oprema za trening");
    expect(expenseRowTitle({ ...expense, note: null, merchant: "Maxi" } as Expense)).toBe("Maxi");
    expect(expenseRowTitle({ ...expense, note: null } as Expense)).toBe("Trošak");
  });

  it("turns rows into buttons that report the expense", () => {
    const onSelect = vi.fn<(e: Expense) => void>();
    render(<LinkedExpensesList expenses={[expense]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Detalji troška Oprema za trening" }));
    expect(onSelect).toHaveBeenCalledWith(expense);
  });
});
