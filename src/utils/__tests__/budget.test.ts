import { describe, expect, it } from "vitest";
import type { Expense, ExpenseCategory, Income, Payment, PaymentOverride } from "@/types/database";
import { computeMonthlyCycle, monthLabel, monthOf, monthRange, shiftMonth } from "../budget";
import { overrideKey } from "../payment";

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

function income(over: Partial<Income> = {}): Income {
  return {
    id: "inc1",
    family_id: "fam",
    person_id: null,
    name: "Plata",
    amount: 100000,
    day_of_month: 1,
    is_recurring: true,
    active: true,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp1",
    family_id: "fam",
    amount: 1000,
    currency: "RSD",
    spent_on: "2026-07-05",
    category_id: null,
    person_id: null,
    note: null,
    source: "manual",
    payment_id: null,
    payment_due_date: null,
    activity_id: null,
    event_id: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay1",
    family_id: "fam",
    name: "Kirija",
    description: null,
    amount: 50000,
    due_date: "2026-07-10",
    is_recurring: true,
    recurrence_period: "monthly",
    recurrence_interval: 1,
    remaining_occurrences: null,
    is_paid: false,
    is_paused: false,
    paid_date: null,
    remind_days_before: null,
    activity_id: null,
    event_id: null,
    category_id: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function category(over: Partial<ExpenseCategory> = {}): ExpenseCategory {
  return {
    id: "cat1",
    family_id: "fam",
    name: "Namirnice",
    color: "#22c55e",
    icon: "cart",
    sort_order: 0,
    monthly_limit: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const NO_OVERRIDES = new Map<string, PaymentOverride>();

function base(over: Partial<Parameters<typeof computeMonthlyCycle>[0]> = {}) {
  return {
    month: "2026-07",
    incomes: [],
    expenses: [],
    payments: [],
    paymentOverrides: NO_OVERRIDES,
    categories: [],
    ...over,
  };
}

/* ------------------------------------------------------------------------- */
/* month helpers                                                             */
/* ------------------------------------------------------------------------- */

describe("month helpers", () => {
  it("monthRange spans first..last day, leap-aware", () => {
    expect(monthRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("shiftMonth crosses year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-07", 0)).toBe("2026-07");
  });

  it("monthLabel + monthOf", () => {
    expect(monthLabel("2026-07")).toBe("Jul 2026");
    expect(monthOf("2026-07-15")).toBe("2026-07");
  });
});

/* ------------------------------------------------------------------------- */
/* computeMonthlyCycle                                                       */
/* ------------------------------------------------------------------------- */

describe("computeMonthlyCycle", () => {
  it("empty month with no incomes → hasIncome false, zeroed", () => {
    const c = computeMonthlyCycle(base());
    expect(c.hasIncome).toBe(false);
    expect(c.totalIncome).toBe(0);
    expect(c.totalSpent).toBe(0);
    expect(c.remaining).toBe(0);
    expect(c.projectedUnpaid).toBe(0);
    expect(c.projectedRemaining).toBe(0);
  });

  it("sums only ACTIVE incomes", () => {
    const c = computeMonthlyCycle(
      base({
        incomes: [
          income({ id: "a", amount: 100000 }),
          income({ id: "b", amount: 50000 }),
          income({ id: "c", amount: 999, active: false }),
        ],
      }),
    );
    expect(c.hasIncome).toBe(true);
    expect(c.totalIncome).toBe(150000);
  });

  it("counts only expenses whose spent_on is in the month (boundaries)", () => {
    const c = computeMonthlyCycle(
      base({
        incomes: [income({ amount: 100000 })],
        expenses: [
          expense({ id: "in1", amount: 3000, spent_on: "2026-07-01" }),
          expense({ id: "in2", amount: 2000, spent_on: "2026-07-31" }),
          expense({ id: "out1", amount: 9999, spent_on: "2026-06-30" }),
          expense({ id: "out2", amount: 8888, spent_on: "2026-08-01" }),
        ],
      }),
    );
    expect(c.totalSpent).toBe(5000);
    expect(c.remaining).toBe(95000);
  });

  it("projects an unpaid monthly occurrence due this month", () => {
    const c = computeMonthlyCycle(
      base({
        incomes: [income({ amount: 200000 })],
        expenses: [expense({ amount: 30000, spent_on: "2026-07-05" })],
        payments: [payment({ amount: 50000, due_date: "2026-07-10" })],
      }),
    );
    // 200000 income − 30000 spent = 170000 remaining; − 50000 unpaid = 120000.
    expect(c.totalSpent).toBe(30000);
    expect(c.remaining).toBe(170000);
    expect(c.projectedUnpaid).toBe(50000);
    expect(c.projectedRemaining).toBe(120000);
  });

  it("skips paid and paused payments from the projection", () => {
    const c = computeMonthlyCycle(
      base({
        incomes: [income({ amount: 100000 })],
        payments: [
          payment({
            id: "paid",
            is_paid: true,
            recurrence_period: "one-time",
            due_date: "2026-07-15",
          }),
          payment({ id: "paused", is_paused: true, due_date: "2026-07-20" }),
        ],
      }),
    );
    expect(c.projectedUnpaid).toBe(0);
    expect(c.projectedRemaining).toBe(100000);
  });

  it("counts multiple weekly occurrences within the month", () => {
    const c = computeMonthlyCycle(
      base({
        incomes: [income({ amount: 100000 })],
        payments: [
          payment({
            recurrence_period: "weekly",
            recurrence_interval: 1,
            amount: 1000,
            due_date: "2026-07-06", // Mondays: 6,13,20,27 → 4 occurrences
          }),
        ],
      }),
    );
    expect(c.projectedUnpaid).toBe(4000);
  });

  it("excludes a canceled occurrence via the override map", () => {
    const overrides = new Map<string, PaymentOverride>();
    overrides.set(overrideKey("pay1", "2026-07-10"), {
      id: "o1",
      payment_id: "pay1",
      family_id: "fam",
      occurrence_date: "2026-07-10",
      action: "cancel",
      override_date: null,
      reason: null,
      created_at: "",
      updated_at: "",
    });
    const c = computeMonthlyCycle(
      base({
        incomes: [income({ amount: 100000 })],
        payments: [payment({ id: "pay1", amount: 50000, due_date: "2026-07-10" })],
        paymentOverrides: overrides,
      }),
    );
    expect(c.projectedUnpaid).toBe(0);
  });

  it("does not project an occurrence outside the month", () => {
    const c = computeMonthlyCycle(
      base({
        incomes: [income({ amount: 100000 })],
        // Monthly bill due in August — no July occurrence.
        payments: [payment({ amount: 50000, due_date: "2026-08-10" })],
      }),
    );
    expect(c.projectedUnpaid).toBe(0);
  });

  it("computes per-category spent / limit / pct", () => {
    const c = computeMonthlyCycle(
      base({
        incomes: [income({ amount: 100000 })],
        categories: [
          category({ id: "cat1", monthly_limit: 40000 }),
          category({ id: "cat2", monthly_limit: null }),
        ],
        expenses: [
          expense({ id: "e1", amount: 30000, spent_on: "2026-07-03", category_id: "cat1" }),
          expense({ id: "e2", amount: 5000, spent_on: "2026-07-04", category_id: "cat2" }),
        ],
      }),
    );
    const cat1 = c.perCategory.find((p) => p.categoryId === "cat1");
    const cat2 = c.perCategory.find((p) => p.categoryId === "cat2");
    expect(cat1).toMatchObject({ spent: 30000, limit: 40000, pct: 75 });
    expect(cat2).toMatchObject({ spent: 5000, limit: null, pct: 0 });
  });
});
