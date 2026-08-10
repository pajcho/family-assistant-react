import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberFilterChips } from "@/components/common/MemberFilterChips";

/**
 * The one implementation of "a family member, as a filter chip". What it owes
 * every filter row that embeds it: first names as labels, the member's own
 * emoji when the viewer reads members that way, and nothing at all when there
 * is nobody to narrow to.
 *
 * Both hooks reach `@/lib/supabase` at import time, which throws without env
 * vars - fine locally, fatal on CI. Hence the mocks (same shape as
 * `MemberAvatar.test.tsx`).
 */
const h = vi.hoisted(() => ({
  members: [] as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    color: string | null;
    avatar_emoji?: string | null;
  }>,
  emoji: undefined as string | undefined,
}));

vi.mock("@/hooks/useFamilyMembers", () => ({
  useFamilyMembers: () => ({ members: h.members, byId: new Map(), isLoading: false }),
}));

vi.mock("@/hooks/useMemberAvatarStyle", () => ({
  useMemberEmoji: () => () => h.emoji,
}));

const ana = { id: "ana-1", first_name: "Ana", last_name: "Petrović", color: "#10b981" };
const vuk = { id: "vuk-1", first_name: "Vuk", last_name: "Ilić", color: "#3b82f6" };

/** Most cases only look at what is drawn - only one of them clicks. */
const ignoreToggle = (_personId: string): void => {};

describe("MemberFilterChips", () => {
  it("renders one chip per member, labelled with the first name", () => {
    h.members = [ana, vuk];
    h.emoji = undefined;
    render(<MemberFilterChips selected={new Set()} onToggle={ignoreToggle} />);

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Ana" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vuk" })).toBeInTheDocument();
  });

  it("falls back to Bez imena for a member with no name at all", () => {
    h.members = [{ id: "x-1", first_name: null, last_name: null, color: null }, ana];
    h.emoji = undefined;
    render(<MemberFilterChips selected={new Set()} onToggle={ignoreToggle} />);

    expect(screen.getByRole("button", { name: "Bez imena" })).toBeInTheDocument();
  });

  it("draws the member emoji once the viewer asks for emoji", () => {
    // The drift this component exists to end: payments and budget drew their
    // own chips and never got this.
    h.members = [ana, vuk];
    h.emoji = "🦊";
    render(<MemberFilterChips selected={new Set()} onToggle={ignoreToggle} />);

    expect(screen.getByRole("button", { name: "Ana" })).toHaveTextContent("🦊");
  });

  it("renders nothing when there is nobody to narrow to", () => {
    h.emoji = undefined;

    h.members = [];
    const empty = render(<MemberFilterChips selected={new Set()} onToggle={ignoreToggle} />);
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();

    h.members = [ana];
    const alone = render(<MemberFilterChips selected={new Set()} onToggle={ignoreToggle} />);
    expect(alone.container).toBeEmptyDOMElement();
  });

  it("reports the clicked member's id", () => {
    h.members = [ana, vuk];
    h.emoji = undefined;
    const onToggle = vi.fn<(personId: string) => void>();
    render(<MemberFilterChips selected={new Set()} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Vuk" }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("vuk-1");
  });

  it("lights only the members in the selected set", () => {
    h.members = [ana, vuk];
    h.emoji = undefined;
    render(<MemberFilterChips selected={new Set(["vuk-1"])} onToggle={ignoreToggle} />);

    expect(screen.getByRole("button", { name: "Ana" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Vuk" })).toHaveAttribute("aria-pressed", "true");
  });
});
