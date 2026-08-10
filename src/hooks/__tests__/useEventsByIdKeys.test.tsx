import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";

/**
 * `useEventById` caches a ROW, `useEventsByIds` caches an ARRAY. They used to
 * share the root key `["events_by_id", familyId, <ids>]`, so a payment linked
 * to exactly ONE event made the two keys identical: the batch hook (mounted by
 * the payment detail sheet's "Povezano sa" row) filled the cache with `[event]`
 * and the by-id hook then handed that list to the event form as if it were an
 * event - which rendered as a blank edit-event dialog.
 *
 * These tests pin what keeps that from coming back: distinct keys for the two
 * shapes, and both nested under ["events", familyId] so every event mutation's
 * invalidation still reaches them.
 */

type EventRow = { id: string; name: string; date: string };
type SingleResult = { data: EventRow | null; error: null };
type ListResult = { data: EventRow[]; error: null };

const mocks = vi.hoisted(() => {
  const row: EventRow = { id: "evt-1", name: "Sonja frizer", date: "2026-05-14" };
  const single = vi.fn<() => Promise<SingleResult>>(() =>
    Promise.resolve({ data: row, error: null }),
  );
  const inFilter = vi.fn<() => Promise<ListResult>>(() =>
    Promise.resolve({ data: [row], error: null }),
  );
  return {
    row,
    from: vi.fn<
      () => { select: () => { eq: () => { single: typeof single }; in: typeof inFilter } }
    >(() => ({ select: () => ({ eq: () => ({ single }), in: inFilter }) })),
  };
});

const EVENT = mocks.row;

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mocks.from },
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ familyId: "fam-1" }),
}));

import { useEventById, useEventsByIds } from "@/hooks/useEvents";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("event by-id query keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("keeps the row and the batch of the same single id in separate caches", async () => {
    const batch = renderHook(() => useEventsByIds(EVENT.id), { wrapper });
    await waitFor(() => expect(batch.result.current.data).toBeDefined());

    const one = renderHook(() => useEventById(EVENT.id), { wrapper });
    await waitFor(() => expect(one.result.current.data).toBeDefined());

    // The batch stays a list; the single stays a row (this is the regression -
    // one key served both and the second hook read the first one's shape).
    expect(Array.isArray(batch.result.current.data)).toBe(true);
    expect(one.result.current.data).toMatchObject({ id: EVENT.id, name: EVENT.name });
  });

  it("nests both keys under ['events', familyId] so invalidation reaches them", async () => {
    renderHook(
      () => {
        useEventsByIds(EVENT.id);
        useEventById(EVENT.id);
      },
      { wrapper },
    );
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(2));

    const matching = client.getQueryCache().findAll({ queryKey: ["events", "fam-1"] });
    expect(matching).toHaveLength(2);
  });
});
