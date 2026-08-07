import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CategoryDetailSheet,
  type CategoryDetailRow,
} from "@/components/budget/CategoryDetailSheet";

vi.mock("@/hooks/useExpenses", () => ({
  useExpenses: () => ({ expenses: [], isLoading: false }),
}));

vi.mock("@/hooks/useExpenseCategories", () => ({
  useUpdateExpenseCategory: () => ({ mutateAsync: vi.fn<() => Promise<void>>(), isPending: false }),
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

  it("closes the overlay while the expense form owns the screen", () => {
    renderSheet({ onAddExpense: vi.fn<(categoryId: string) => void>(), hidden: true });

    expect(screen.queryByText("Namirnice")).toBeNull();
  });
});
