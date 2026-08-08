import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Vidljivo deci" is opt-in and invisible to families that never turned kid
 * mode on, so the two things worth pinning are: the row does not exist without
 * children who can log in, and the write is threaded onto the SAME birthday the
 * caller just created - the id is generated here precisely because no caller
 * hands the created row back.
 */

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn<(input: unknown) => Promise<string>>(),
  state: {
    children: [] as Array<{ id: string; first_name: string | null; last_name: string | null }>,
    byBirthday: new Map<string, Array<{ personId: string; note: string | null }>>(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

vi.mock("@/hooks/useBirthdayVisibility", () => ({
  useBirthdayVisibility: () => ({
    rows: [],
    byBirthday: mocks.state.byBirthday,
    isLoading: false,
  }),
  useBirthdayVisibilityChildren: () => ({
    children: mocks.state.children,
    hasKidMode: mocks.state.children.length > 0,
    isLoading: false,
  }),
  useSaveBirthdayVisibility: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

// Vaul/Radix mark the covered layer `aria-hidden` and only drop it after an
// exit animation jsdom never runs, which hides the form from every accessible
// query the moment a sub-view opens. Swap the shell for plain elements: one
// `dialog` per OPEN sheet level, which is exactly what this suite asserts.
vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  ResponsiveDialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  ResponsiveDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  ResponsiveDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  useIsDesktop: () => false,
}));

// The date picker is a flow of its own; this suite is about the visibility
// field, so stand it up as a plain input.
vi.mock("@/components/common/DateField", () => ({
  DateField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string | null;
    onChange: (value: string | null) => void;
  }) => (
    <input
      aria-label={label}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    />
  ),
}));

import { BirthdayFormDialog } from "@/components/birthdays/BirthdayFormDialog";
import type { Birthday } from "@/types/database";

const luka = { id: "kid-1", first_name: "Luka", last_name: "Petrović" };
const sofija = { id: "kid-2", first_name: "Sofija", last_name: "Petrović" };

const baka: Birthday = {
  id: "b-1",
  family_id: "fam-1",
  name: "Baka Mira",
  description: null,
  birth_date: "1955-04-12",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function visibilityRow() {
  return screen.getByRole("button", { name: /Vidljivo deci/ });
}

describe("BirthdayFormDialog visibility", () => {
  beforeEach(() => {
    mocks.state.children = [];
    mocks.state.byBirthday = new Map();
    mocks.mutateAsync.mockResolvedValue("written");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows nothing about children when the family has no kid access", () => {
    render(
      <BirthdayFormDialog
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        birthday={null}
        onSubmit={vi.fn<(payload: unknown) => void>()}
      />,
    );

    expect(screen.queryByText("Vidljivo deci")).toBeNull();
  });

  it("defaults to nobody and names the children once they are switched on", async () => {
    mocks.state.children = [luka, sofija];
    render(
      <BirthdayFormDialog
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        birthday={baka}
        onSubmit={vi.fn<(payload: unknown) => void>()}
      />,
    );

    expect(visibilityRow()).toHaveTextContent("Niko");

    fireEvent.click(visibilityRow());

    // A NEW sheet level over the form, never an inline panel inside it.
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    const lukaSwitch = await screen.findByRole("switch", { name: /Luka/ });
    expect(lukaSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: /Sofija/ })).toBeTruthy();
    // The note field only exists for a child who actually sees the birthday.
    expect(screen.queryByPlaceholderText("npr. pozovi baku i čestitaj joj")).toBeNull();

    fireEvent.click(lukaSwitch);

    const note = await screen.findByPlaceholderText("npr. pozovi baku i čestitaj joj");
    expect(screen.getByText("Luka ovo čita u svojoj aplikaciji.")).toBeTruthy();
    fireEvent.change(note, { target: { value: "pozovi baku i čestitaj joj" } });

    fireEvent.click(screen.getByRole("button", { name: "Nazad" }));

    await waitFor(() => expect(visibilityRow()).toHaveTextContent("Luka"));
  });

  it("seeds the draft from the stored rows when editing", async () => {
    mocks.state.children = [luka, sofija];
    mocks.state.byBirthday = new Map([["b-1", [{ personId: "kid-2", note: "nacrtaj čestitku" }]]]);
    render(
      <BirthdayFormDialog
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        birthday={baka}
        onSubmit={vi.fn<(payload: unknown) => void>()}
      />,
    );

    expect(visibilityRow()).toHaveTextContent("Sofija");

    fireEvent.click(visibilityRow());

    const sofijaSwitch = await screen.findByRole("switch", { name: /Sofija/ });
    expect(sofijaSwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: /Luka/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByPlaceholderText("npr. pozovi baku i čestitaj joj")).toHaveValue(
      "nacrtaj čestitku",
    );
  });

  it("attaches the entries to the id it generated for a new birthday", async () => {
    mocks.state.children = [luka];
    const onSubmit = vi.fn<(payload: { id?: string }) => void>();
    render(
      <BirthdayFormDialog
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        birthday={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Ime"), { target: { value: "Baka Mira" } });
    fireEvent.change(screen.getByLabelText("Datum rođenja *"), {
      target: { value: "1955-04-12" },
    });
    fireEvent.click(visibilityRow());
    fireEvent.click(await screen.findByRole("switch", { name: /Luka/ }));
    fireEvent.change(screen.getByPlaceholderText("npr. pozovi baku i čestitaj joj"), {
      target: { value: "nacrtaj čestitku" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Nazad" }));

    const form = screen.getByRole("button", { name: "Dodaj" });
    fireEvent.click(form);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ name: "Baka Mira", birth_date: "1955-04-12" });
    expect(typeof payload.id).toBe("string");

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        birthdayId: payload.id,
        entries: [{ personId: "kid-1", note: "nacrtaj čestitku" }],
      }),
    );
  });

  it("waits for the caller's save before writing, and never re-keys an edit", async () => {
    mocks.state.children = [luka];
    let resolveSave!: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onSubmit = vi.fn<(payload: { id?: string }) => Promise<void>>(() => savePromise);
    render(
      <BirthdayFormDialog
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
        birthday={baka}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(visibilityRow());
    fireEvent.click(await screen.findByRole("switch", { name: /Luka/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nazad" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sačuvaj izmene" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // An edit already has an id - the payload must not carry a second one.
    expect(onSubmit.mock.calls[0][0].id).toBeUndefined();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    resolveSave();

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        birthdayId: "b-1",
        entries: [{ personId: "kid-1", note: "" }],
      }),
    );
  });
});
