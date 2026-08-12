import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskWhoSheetBody } from "@/components/tasks/TaskFields";
import { emptyTaskDraft, privateDraftDefaults, type TaskDraft } from "@/components/tasks/taskDraft";
import type { ListScope, Profile } from "@/types/database";

/**
 * "Za koga", and the "Samo ja" switch that leads it.
 *
 * The rules worth pinning are the ones that keep the switch and the assignee
 * pills from telling two different stories: turning it on assigns you, turning
 * it off undoes exactly that, and handing the task to somebody else is the
 * other way out of private. A list then takes the whole question away, because
 * a task inside one carries its list's visibility no matter what we send.
 *
 * Every Supabase-touching hook is mocked with a standalone factory (never
 * `importOriginal`) - CI has no Supabase env.
 */

const { members } = vi.hoisted(() => ({
  members: [
    { id: "me-1", first_name: "Nikola" },
    { id: "ana-1", first_name: "Ana" },
  ] as Profile[],
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ profile: { id: "me-1" } }),
}));

vi.mock("@/hooks/useFamilyMembers", () => ({
  useFamilyMembers: () => ({
    members,
    byId: new Map(members.map((m) => [m.id, m])),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useMemberAvatarStyle", () => ({
  useMemberEmoji: () => () => null,
}));

// Not rendered here, but `TaskFields` imports `DateField`, which reaches
// `lib/supabase` through `useBusyDays` -> `useBirthdays`. CI has no env.
vi.mock("@/hooks/useBusyDays", () => ({
  useBusyDays: () => new Map<string, number>(),
}));

/** Renders the body against real draft state and exposes it for assertions. */
function Harness({
  initial,
  listScope = null,
  onDraft,
}: {
  initial: TaskDraft;
  listScope?: ListScope | null;
  onDraft: (draft: TaskDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  onDraft(draft);
  return <TaskWhoSheetBody draft={draft} setDraft={setDraft} listScope={listScope} />;
}

function setup(initial: TaskDraft, listScope: ListScope | null = null) {
  let latest = initial;
  render(
    <Harness
      initial={initial}
      listScope={listScope}
      onDraft={(draft) => {
        latest = draft;
      }}
    />,
  );
  return {
    onlyMe: () => screen.getByRole("button", { name: "Samo ja" }),
    member: (name: string) => screen.getByRole("button", { name }),
    draft: () => latest,
  };
}

describe("TaskWhoSheetBody", () => {
  it("leads the roster with Samo ja, pressed for a private draft", () => {
    const ui = setup(emptyTaskDraft(privateDraftDefaults("me-1")));
    expect(ui.onlyMe()).toHaveAttribute("aria-pressed", "true");
    // First in the row, before the people - it answers the same question.
    const row = screen.getByRole("group", { name: "Za koga" });
    expect(row.firstElementChild).toHaveTextContent("Samo ja");
    expect(screen.getByText("Vidiš ga samo ti. Niko drugi u porodici ga ne vidi.")).toBeVisible();
  });

  it("assigns the viewer when it is switched on", () => {
    const ui = setup(emptyTaskDraft());
    fireEvent.click(ui.onlyMe());
    expect(ui.draft().onlyMe).toBe(true);
    expect(ui.draft().assigneeIds).toEqual(["me-1"]);
  });

  it("undoes that self-assignment when it is switched off", () => {
    const ui = setup(emptyTaskDraft(privateDraftDefaults("me-1")));
    fireEvent.click(ui.onlyMe());
    expect(ui.draft().onlyMe).toBe(false);
    expect(ui.draft().assigneeIds).toEqual([]);
    expect(
      screen.getByText("Vide ga svi u porodici. Dete vidi samo ono što mu je dodeljeno."),
    ).toBeVisible();
  });

  it("leaves private the moment somebody else is picked", () => {
    const ui = setup(emptyTaskDraft(privateDraftDefaults("me-1")));
    fireEvent.click(ui.member("Ana"));
    expect(ui.draft().onlyMe).toBe(false);
    expect(ui.draft().assigneeIds).toEqual(["me-1", "ana-1"]);
  });

  it("leaves private when the viewer drops themselves", () => {
    const ui = setup(emptyTaskDraft(privateDraftDefaults("me-1")));
    fireEvent.click(ui.member("Nikola"));
    expect(ui.draft().onlyMe).toBe(false);
    expect(ui.draft().assigneeIds).toEqual([]);
  });

  it("hands the question to a family list, which still takes assignees", () => {
    const ui = setup(emptyTaskDraft(), "family");
    expect(ui.onlyMe()).toBeDisabled();
    expect(ui.member("Ana")).toBeEnabled();
    expect(
      screen.getByText(
        "Lista je porodična, pa zadatak vide svi. Dete vidi samo ono što mu je dodeljeno.",
      ),
    ).toBeVisible();
  });

  it("hands it to a personal list, which takes nobody", () => {
    const ui = setup(emptyTaskDraft(), "personal");
    expect(ui.onlyMe()).toBeDisabled();
    expect(ui.member("Ana")).toBeDisabled();
    expect(
      screen.getByText("Lista je lična, pa zadatak vidiš samo ti - i nema kome da se dodeli."),
    ).toBeVisible();
  });
});
