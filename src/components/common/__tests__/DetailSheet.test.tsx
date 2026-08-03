import { fireEvent, render, screen } from "@testing-library/react";
import { CheckIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";
import { describe, expect, it, vi } from "vitest";

import { DetailActionRow, DetailBadgeRow, DetailInfoText } from "@/components/common/DetailSheet";

describe("DetailActionRow", () => {
  it("renders label + description and fires onClick", () => {
    const onClick = vi.fn<() => void>();
    render(
      <DetailActionRow
        icon={PencilSquareIcon}
        label="Izmeni plaćanje"
        description="Naziv, iznos, ponavljanje"
        onClick={onClick}
      />,
    );

    const row = screen.getByRole("button", { name: /Izmeni plaćanje/ });
    expect(row).toHaveTextContent("Naziv, iznos, ponavljanje");
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("blocks clicks while disabled", () => {
    const onClick = vi.fn<() => void>();
    render(
      <DetailActionRow
        icon={TrashIcon}
        label="Obriši"
        onClick={onClick}
        disabled
        tone="destructive"
      />,
    );

    const row = screen.getByRole("button", { name: "Obriši" });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders an external link when href is set", () => {
    render(<DetailActionRow icon={CheckIcon} label="Otvori u Google" href="https://example.com" />);

    const link = screen.getByRole("link", { name: /Otvori u Google/ });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("DetailBadgeRow", () => {
  it("renders nothing without badges", () => {
    const { container } = render(<DetailBadgeRow badges={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one pill per badge", () => {
    render(
      <DetailBadgeRow
        badges={[
          { label: "Plaćeno", className: "bg-emerald-100" },
          { label: "Dospeva 5.8.2026.", className: "bg-gray-100" },
        ]}
      />,
    );
    expect(screen.getByText("Plaćeno")).toBeInTheDocument();
    expect(screen.getByText("Dospeva 5.8.2026.")).toBeInTheDocument();
  });
});

describe("DetailInfoText", () => {
  it("renders the label-value pair", () => {
    render(<DetailInfoText label="Opis" value="Mesečna članarina" />);
    expect(screen.getByText("Opis")).toBeInTheDocument();
    expect(screen.getByText("Mesečna članarina")).toBeInTheDocument();
  });
});
