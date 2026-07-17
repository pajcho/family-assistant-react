import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, SVGProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { AddMenu } from "@/components/dashboard/AddMenu";

vi.mock("@/components/common/AddSheetMenu", () => ({
  AddSheetMenu: ({
    items,
  }: {
    items: ReadonlyArray<{
      key: string;
      label: string;
      icon: ComponentType<SVGProps<SVGSVGElement>>;
      onSelect: () => void;
    }>;
  }) => (
    <ol>
      {items.map((item) => (
        <li key={item.key}>
          <button type="button" onClick={item.onSelect}>
            {item.label}
          </button>
        </li>
      ))}
    </ol>
  ),
}));

describe("dashboard AddMenu", () => {
  it("places expense in the sixth tile and opens its in-place flow", () => {
    const onAddExpense = vi.fn<() => void>();
    const { container } = render(
      <AddMenu
        onAddActivity={vi.fn<() => void>()}
        onAddEvent={vi.fn<() => void>()}
        onAddPayment={vi.fn<() => void>()}
        onAddBirthday={vi.fn<() => void>()}
        onAddList={vi.fn<() => void>()}
        onAddExpense={onAddExpense}
      />,
    );

    expect(Array.from(container.querySelectorAll("li"), (item) => item.textContent)).toEqual([
      "Aktivnost",
      "Događaj",
      "Plaćanje",
      "Rođendan",
      "Lista",
      "Trošak",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Trošak" }));
    expect(onAddExpense).toHaveBeenCalledOnce();
  });
});
