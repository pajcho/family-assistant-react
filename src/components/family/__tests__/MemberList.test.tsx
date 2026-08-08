import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberList } from "@/components/family/MemberList";
import type { Profile } from "@/types/database";

// The real hooks reach `@/lib/supabase`, which throws at import time without
// env vars (fine locally, fatal on CI).
const h = vi.hoisted(() => ({
  enabledIds: new Set<string>(),
  avatarStyle: "initials" as "initials" | "emoji",
}));

vi.mock("@/hooks/useKidAccess", () => ({
  useKidAccessList: () => ({
    rows: [],
    byProfileId: new Map(),
    enabledIds: h.enabledIds,
    isLoading: false,
    isError: false,
  }),
}));

// The row's tile follows the viewer's "Prikaz članova" setting.
vi.mock("@/hooks/useMemberAvatarStyle", () => ({
  useMemberAvatarStyleValue: () => h.avatarStyle,
}));

function profile(overrides: Partial<Profile> & Pick<Profile, "id">): Profile {
  return {
    family_id: "fam-1",
    full_name: null,
    first_name: "Član",
    last_name: null,
    avatar_url: null,
    color: null,
    is_admin: false,
    onboarding_hidden_at: null,
    nav_slots: null,
    accent: null,
    avatar_emoji: null,
    member_avatar_style: null,
    has_login: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const luka = profile({ id: "kid-1", first_name: "Luka", avatar_emoji: "🦖" });
const mama = profile({ id: "parent-1", first_name: "Mama", has_login: true, is_admin: true });

function renderList(studentIds: Set<string> = new Set()) {
  return render(
    <MemberList
      members={[mama, luka]}
      selectedId={null}
      onSelect={vi.fn<(id: string) => void>()}
      studentIds={studentIds}
      currentUserId="parent-1"
      canManage
      onAdd={vi.fn<() => void>()}
    />,
  );
}

afterEach(() => {
  h.avatarStyle = "initials";
});

describe("MemberList kid pill", () => {
  it("tags only the members who actually have kid access", () => {
    h.enabledIds = new Set(["kid-1"]);
    renderList();

    const lukaRow = screen.getByRole("button", { name: /Luka/ });
    expect(within(lukaRow).getByText("Dete")).toBeInTheDocument();

    const mamaRow = screen.getByRole("button", { name: /Mama/ });
    expect(within(mamaRow).queryByText("Dete")).toBeNull();
  });

  it("shows no pill at all when nobody has kid access", () => {
    h.enabledIds = new Set();
    renderList();
    expect(screen.queryByText("Dete")).toBeNull();
  });

  it("swaps the row tile for the member's emoji when the viewer asked for it", () => {
    h.enabledIds = new Set();
    h.avatarStyle = "emoji";
    renderList();
    expect(screen.getByRole("button", { name: /Luka/ })).toHaveTextContent("🦖");
  });

  it("uses the accent colourway, not the one Učenik already owns", () => {
    h.enabledIds = new Set(["kid-1"]);
    renderList(new Set(["kid-1"]));

    const lukaRow = screen.getByRole("button", { name: /Luka/ });
    expect(within(lukaRow).getByText("Dete")).toHaveClass("bg-accent-soft", "text-accent-deep");
    expect(within(lukaRow).getByText("Učenik")).toHaveClass("bg-info-soft", "text-info");
  });
});
