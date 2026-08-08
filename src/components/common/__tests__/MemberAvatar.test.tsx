import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberAvatar } from "@/components/common/MemberAvatar";
import { avatarForProfile } from "@/utils/memberAvatar";

/**
 * The tile is the app's single answer to "draw this person", so what it owes
 * the rest of the UI is: the viewer's setting decides the LOOK, the member's
 * own row decides the CONTENT, and the colour survives either way (the same hue
 * tints this person's blocks in the calendar).
 *
 * The style hook reaches `@/lib/supabase` through `useProfile`, which throws at
 * import time without env vars - fine locally, fatal on CI. Hence the mock.
 */
const h = vi.hoisted(() => ({ avatarStyle: "initials" as "initials" | "emoji" }));

vi.mock("@/hooks/useMemberAvatarStyle", () => ({
  useMemberAvatarStyleValue: () => h.avatarStyle,
}));

const ana = {
  id: "ana-1",
  first_name: "Ana",
  last_name: "Petrović",
  color: "#10b981",
  avatar_emoji: null as string | null,
};

describe("MemberAvatar", () => {
  it("draws initials on the member's colour by default", () => {
    h.avatarStyle = "initials";
    render(<MemberAvatar member={ana} title="Ana" />);

    const tile = screen.getByRole("img", { name: "Ana" });
    expect(tile).toHaveTextContent("AP");
    expect(tile).toHaveStyle({ backgroundColor: "#10b981" });
  });

  it("draws the picked emoji once the viewer asks for emoji", () => {
    h.avatarStyle = "emoji";
    render(<MemberAvatar member={{ ...ana, avatar_emoji: "👧" }} title="Ana" />);

    const tile = screen.getByRole("img", { name: "Ana" });
    expect(tile).toHaveTextContent("👧");
    expect(tile).not.toHaveTextContent("AP");
  });

  it("falls back to the automatic animal for a member nobody has picked for", () => {
    h.avatarStyle = "emoji";
    render(<MemberAvatar member={ana} title="Ana" />);

    expect(screen.getByRole("img", { name: "Ana" })).toHaveTextContent(avatarForProfile("ana-1"));
  });

  it("still finds an emoji when the roster row has not arrived", () => {
    h.avatarStyle = "emoji";
    render(<MemberAvatar personId="vuk-1" title="Vuk" />);

    expect(screen.getByRole("img", { name: "Vuk" })).toHaveTextContent(avatarForProfile("vuk-1"));
  });

  it("keeps the member's colour as the emoji tile's tint", () => {
    // Colour coding is load-bearing elsewhere - an emoji tile that dropped it
    // would cut the badge loose from the person's blocks in the calendar.
    h.avatarStyle = "emoji";
    const { container } = render(<MemberAvatar member={ana} title="Ana" />);

    // jsdom may hand the colour back as hex or as rgb() inside the color-mix,
    // depending on the property - the assertion is about the hue surviving.
    const green = /#10b981|rgb\(16,\s*185,\s*129\)/;
    const tile = container.querySelector<HTMLElement>('[role="img"]');
    expect(tile?.style.backgroundColor).toMatch(green);
    expect(tile?.style.borderColor).toMatch(green);
  });

  it("announces the name, never the initials, and stays silent without one", () => {
    h.avatarStyle = "initials";
    const { rerender, container } = render(<MemberAvatar member={ana} title="Ana" />);
    expect(screen.queryByRole("img", { name: "AP" })).toBeNull();
    expect(screen.getByRole("img", { name: "Ana" })).toBeInTheDocument();

    // No title: the name is already written next to the tile (member list rows,
    // member detail header), so the tile is pure decoration.
    rerender(<MemberAvatar member={ana} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
