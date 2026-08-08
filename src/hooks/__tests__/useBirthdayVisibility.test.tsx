import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The birthday-visibility write is a DIFF, not a replace: a parent editing one
 * child's note must not churn the other children's rows (and must not delete +
 * reinsert them, which would lose nothing today but would fight the primary
 * key). These tests pin the three outcomes - only changed rows are upserted,
 * only dropped children are deleted, an untouched draft costs zero requests -
 * plus the create-path retry, where the write can reach the server before the
 * birthday it hangs off does.
 */

const mocks = vi.hoisted(() => ({
  select: vi.fn<(table: string) => Promise<{ data: unknown; error: unknown }>>(),
  upsert: vi.fn<(rows: unknown, options: unknown) => Promise<{ error: unknown }>>(),
  deleteIn: vi.fn<(birthdayId: unknown, personIds: unknown) => Promise<{ error: unknown }>>(),
  errorToast: vi.fn<(message: string) => void>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({ eq: () => mocks.select(table) }),
      upsert: (rows: unknown, options: unknown) => mocks.upsert(rows, options),
      delete: () => ({
        eq: (_column: string, birthdayId: unknown) => ({
          in: (_personColumn: string, personIds: unknown) => mocks.deleteIn(birthdayId, personIds),
        }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ familyId: "fam-1" }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.errorToast },
}));

import type { BirthdayVisibility } from "@/types/database";
import { useBirthdayVisibility, useSaveBirthdayVisibility } from "@/hooks/useBirthdayVisibility";

const stored: BirthdayVisibility[] = [
  {
    birthday_id: "b-1",
    person_id: "kid-1",
    family_id: "fam-1",
    note: "pozovi baku i čestitaj joj",
    created_at: "2026-08-01T10:00:00Z",
  },
  {
    birthday_id: "b-1",
    person_id: "kid-2",
    family_id: "fam-1",
    note: null,
    created_at: "2026-08-01T10:00:00Z",
  },
  {
    birthday_id: "b-2",
    person_id: "kid-1",
    family_id: "fam-1",
    note: null,
    created_at: "2026-08-01T10:00:00Z",
  },
];

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("useBirthdayVisibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.deleteIn.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups the family rows by birthday", async () => {
    mocks.select.mockResolvedValue({ data: stored, error: null });
    const { wrapper } = setup();

    const { result } = renderHook(() => useBirthdayVisibility(), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.byBirthday.get("b-1")).toEqual([
      { personId: "kid-1", note: "pozovi baku i čestitaj joj" },
      { personId: "kid-2", note: null },
    ]);
    expect(result.current.byBirthday.get("b-2")).toEqual([{ personId: "kid-1", note: null }]);
  });

  it("upserts only what changed and deletes only what was dropped", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(["birthday_visibility", "fam-1"], stored);

    const { result } = renderHook(() => useSaveBirthdayVisibility(), { wrapper });
    const outcome = await result.current.mutateAsync({
      birthdayId: "b-1",
      entries: [
        { personId: "kid-1", note: "nacrtaj čestitku" },
        // Whitespace-only notes are stored as NULL, not as an empty string.
        { personId: "kid-3", note: "   " },
      ],
    });

    expect(outcome).toBe("written");
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith(
      [
        {
          birthday_id: "b-1",
          person_id: "kid-1",
          family_id: "fam-1",
          note: "nacrtaj čestitku",
        },
        { birthday_id: "b-1", person_id: "kid-3", family_id: "fam-1", note: null },
      ],
      { onConflict: "birthday_id,person_id" },
    );
    // kid-2 lost visibility; b-2's row for kid-1 is untouched.
    expect(mocks.deleteIn).toHaveBeenCalledWith("b-1", ["kid-2"]);
  });

  it("makes no request at all when the draft matches what is stored", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(["birthday_visibility", "fam-1"], stored);

    const { result } = renderHook(() => useSaveBirthdayVisibility(), { wrapper });
    const outcome = await result.current.mutateAsync({
      birthdayId: "b-1",
      entries: [
        { personId: "kid-1", note: "pozovi baku i čestitaj joj" },
        { personId: "kid-2", note: null },
      ],
    });

    expect(outcome).toBe("unchanged");
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteIn).not.toHaveBeenCalled();
  });

  it("retries the create-path FK violation until the birthday lands", async () => {
    const { wrapper } = setup();
    mocks.upsert
      .mockResolvedValueOnce({ error: { code: "23503", message: "foreign key" } })
      .mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useSaveBirthdayVisibility(), { wrapper });
    const outcome = await result.current.mutateAsync({
      birthdayId: "b-new",
      entries: [{ personId: "kid-1", note: null }],
    });

    expect(outcome).toBe("written");
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.errorToast).not.toHaveBeenCalled();
  });

  it("gives up quietly when the birthday never lands, and loudly on a real error", async () => {
    const { wrapper } = setup();
    mocks.upsert.mockResolvedValue({ error: { code: "23503", message: "foreign key" } });

    const { result } = renderHook(() => useSaveBirthdayVisibility(), { wrapper });
    vi.useFakeTimers();
    const pending = result.current.mutateAsync({
      birthdayId: "b-never",
      entries: [{ personId: "kid-1", note: null }],
    });
    await vi.advanceTimersByTimeAsync(10_000);
    // The failed birthday create already told the user - a second toast would
    // blame the wrong thing.
    await expect(pending).resolves.toBe("birthday-missing");
    expect(mocks.errorToast).not.toHaveBeenCalled();
    vi.useRealTimers();

    mocks.upsert.mockResolvedValue({ error: { code: "42501", message: "row-level security" } });
    await expect(
      result.current.mutateAsync({
        birthdayId: "b-1",
        entries: [{ personId: "kid-1", note: null }],
      }),
    ).rejects.toThrow("row-level security");
    await waitFor(() => expect(mocks.errorToast).toHaveBeenCalledWith("row-level security"));
  });
});
