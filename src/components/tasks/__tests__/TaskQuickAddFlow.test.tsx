import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskQuickAddFlow } from "@/components/tasks/TaskQuickAddFlow";
import { readRecentListIds } from "@/lib/recentLists";
import type { ListScope, ListWithTasks } from "@/types/database";

/**
 * Where "Dodaj → Zadatak" opens: the Inbox, unless the caller picked a list.
 * `initialListId` is three states (an id, an explicit `null`, `undefined` for
 * "no opinion") and the last two both mean the Inbox. The device's list memory
 * survives only as the one-tap chip row, which the Inbox leads. That memory is
 * `lib/recentLists` and real localStorage, so these tests exercise the true
 * store rather than a mock of it.
 *
 * Every Supabase-touching hook is mocked with a standalone factory (never
 * `importOriginal`) - CI has no Supabase env.
 */

const { mutateAsync, successToast, navigate } = vi.hoisted(() => ({
  mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
  successToast: vi.fn<(message: string, options?: unknown) => void>(),
  navigate: vi.fn<(options: unknown) => void>(),
}));

vi.mock("sonner", () => ({
  toast: { success: successToast },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ profile: { id: "viewer-1" } }),
}));

function list(id: string, name: string, scope: ListScope = "family"): ListWithTasks {
  return {
    id,
    family_id: "fam-1",
    owner_id: "viewer-1",
    updated_by_id: null,
    name,
    description: null,
    scope,
    sort_order: 0,
    smart_sort_enabled: false,
    auto_delete_completed_after_hours: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    tasks: [],
  };
}

const LISTS = [list("l1", "Radovi"), list("l2", "Šoping")];

vi.mock("@/hooks/useTasks", () => ({
  useCreateTask: () => ({ mutateAsync, isPending: false }),
  useListsWithTasks: () => ({ data: LISTS, isLoading: false }),
}));

// The optional-dimension editors reach Supabase through `useFamilyMembers` and
// `useBusyDays`; the list choice under test lives outside them.
vi.mock("@/components/tasks/TaskFields", () => ({
  TaskAllFields: () => null,
  useSelfAssignWhenPrivate: () => {},
}));

// vaul needs a real layout engine; jsdom is not one. The sheet chrome is not
// under test - the form inside it is.
vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  ResponsiveDialogContent: ({
    children,
    stickyFooter,
  }: {
    children?: ReactNode;
    stickyFooter?: ReactNode;
  }) => (
    <div>
      {children}
      {stickyFooter}
    </div>
  ),
  ResponsiveDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResponsiveDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  ResponsiveDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

function remember(ids: string[]) {
  window.localStorage.setItem("lists.recentIds.v1", JSON.stringify(ids));
}

function listSelect(): HTMLSelectElement {
  return screen.getByLabelText("Lista");
}

function submitForm() {
  fireEvent.submit(document.getElementById("task-quick-add") as HTMLFormElement);
}

describe("TaskQuickAddFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("opens on the Inbox when the caller has no opinion, whatever this device last used", () => {
    remember(["l2", "l1"]);
    render(<TaskQuickAddFlow open onOpenChange={vi.fn<(open: boolean) => void>()} />);

    expect(listSelect().value).toBe("");
    // The memory survives as one-tap picks: the Inbox leads, then most recent.
    const chips = screen.getAllByRole("button", { name: /Šoping|Radovi|^Inbox$/ });
    expect(chips.map((chip) => chip.textContent)).toEqual(["Inbox", "Šoping", "Radovi"]);
  });

  it("lets an explicit id win over the memory", () => {
    remember(["l2"]);
    render(
      <TaskQuickAddFlow open onOpenChange={vi.fn<(open: boolean) => void>()} initialListId="l1" />,
    );
    expect(listSelect().value).toBe("l1");
  });

  it("keeps an explicit null meaning the Inbox", () => {
    remember(["l2"]);
    render(
      <TaskQuickAddFlow
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        initialListId={null}
      />,
    );
    expect(listSelect().value).toBe("");
  });

  it("falls back to the Inbox when the handed-over list is gone", async () => {
    render(
      <TaskQuickAddFlow
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        initialListId="deleted-list"
      />,
    );
    await waitFor(() => expect(listSelect().value).toBe(""));
  });

  it("records a successful add as the device's most recent list", async () => {
    remember(["l2"]);
    // Picked by hand below - the sheet itself opens on the Inbox now.
    mutateAsync.mockResolvedValue({});
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<TaskQuickAddFlow open onOpenChange={onOpenChange} />);

    fireEvent.change(listSelect(), { target: { value: "l1" } });
    fireEvent.change(screen.getByLabelText("Naziv *"), { target: { value: "Kupi farbu" } });
    submitForm();

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ list_id: "l1" })),
    );
    expect(readRecentListIds()).toEqual(["l1", "l2"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(successToast).toHaveBeenCalledWith("Zadatak je dodat.", expect.anything());
  });

  it("records nothing for an add into the Inbox", async () => {
    mutateAsync.mockResolvedValue({});
    render(
      <TaskQuickAddFlow
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        initialListId={null}
      />,
    );

    fireEvent.change(screen.getByLabelText("Naziv *"), { target: { value: "Zvati majstora" } });
    submitForm();

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ list_id: null })),
    );
    expect(readRecentListIds()).toEqual([]);
  });
});
