import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * What is pinned here is the reason this component exists and the two ways it
 * is easy to get wrong:
 *
 *   * NULL authorship is normal - rows written before the columns existed, and
 *     rows written by pg_cron or an edge function with no acting user. The line
 *     must degrade to the date rather than render "nepoznat" or a raw UUID.
 *   * Serbian past participles are gendered and the app does not know a
 *     member's gender, so no copy here may ever say "Dodao" or "Dodala".
 */

vi.mock("@/hooks/useFamilyMembers", () => ({
  useFamilyMembers: () => ({
    byId: new Map([
      ["p1", { first_name: "Marija", last_name: "Perić" }],
      ["p2", { first_name: "Nikola", last_name: "Perić" }],
    ]),
  }),
}));

import { DetailAuditLine, type AuditedRow } from "@/components/common/DetailAuditLine";

const CREATED = "2026-01-12T20:41:00.000Z";

function row(overrides: Partial<AuditedRow> = {}): AuditedRow {
  return {
    created_by_id: "p1",
    updated_by_id: "p1",
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

describe("DetailAuditLine", () => {
  it("names the creator and dates the creation", () => {
    render(<DetailAuditLine row={row()} />);
    expect(screen.getByText(/Dodato: Marija/)).toBeInTheDocument();
    expect(screen.getByText(/12\.01\.2026/)).toBeInTheDocument();
  });

  it("says nothing about edits while the row is untouched", () => {
    render(<DetailAuditLine row={row()} />);
    expect(screen.queryByText(/izmenjeno/)).not.toBeInTheDocument();
  });

  it("names the editor when someone else made the change", () => {
    render(
      <DetailAuditLine
        row={row({ updated_by_id: "p2", updated_at: "2026-06-01T09:00:00.000Z" })}
      />,
    );
    expect(screen.getByText(/izmenjeno: Nikola/)).toBeInTheDocument();
  });

  it("drops the name when the creator is also the last editor", () => {
    render(<DetailAuditLine row={row({ updated_at: "2026-06-01T09:00:00.000Z" })} />);
    // The name is already on the line once; repeating it says nothing new.
    expect(screen.queryByText(/izmenjeno: Marija/)).not.toBeInTheDocument();
    expect(screen.getByText(/izmenjeno pre/)).toBeInTheDocument();
  });

  it("falls back to the bare date when the author is unknown", () => {
    render(<DetailAuditLine row={row({ created_by_id: null, updated_by_id: null })} />);
    expect(screen.getByText(/Dodato 12\.01\.2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Dodato:/)).not.toBeInTheDocument();
  });

  it("survives an author who is no longer in the family", () => {
    render(<DetailAuditLine row={row({ created_by_id: "gone", updated_by_id: "gone" })} />);
    // Not a crash, not a raw UUID - just the date, as if unknown.
    expect(screen.getByText(/Dodato 12\.01\.2026/)).toBeInTheDocument();
    expect(screen.queryByText(/gone/)).not.toBeInTheDocument();
  });

  it("never uses a verb form that assumes the member's gender", () => {
    const { container } = render(
      <DetailAuditLine
        row={row({ updated_by_id: "p2", updated_at: "2026-06-01T09:00:00.000Z" })}
      />,
    );
    expect(container.textContent).not.toMatch(/Doda[ol]a?\b/);
    expect(container.textContent).not.toMatch(/Izmen(io|ila)\b/);
  });

  it("is a plain caption until a history handler is wired", () => {
    render(<DetailAuditLine row={row()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("becomes a button that opens the history when one is given", () => {
    const onOpenHistory = vi.fn<() => void>();
    render(<DetailAuditLine row={row()} onOpenHistory={onOpenHistory} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenHistory).toHaveBeenCalledOnce();
  });
});
