import { describe, expect, it, vi } from "vitest";

// The module under test imports the real client, which throws without
// VITE_SUPABASE_* - present locally, absent on CI.
vi.mock("@/lib/supabase", () => ({ supabase: { channel: vi.fn<() => never>() } }));

import { invalidationKeysFor } from "@/hooks/useFamilyChannel";

/**
 * The timer itself is trivial (`setTimeout` + a Set); what is worth pinning
 * down is the rule it flushes with - collect table names, emit each query key
 * once. Testing the pure step keeps this out of fake-timer territory.
 */
const FAMILY = "fam-1";

describe("invalidationKeysFor", () => {
  it("emits a shared key once for a burst that touches it repeatedly", () => {
    // One mark-as-paid: the write, its history row, and the expense a
    // trigger creates. Both payment tables map onto ["payments", familyId].
    const keys = invalidationKeysFor(["payments", "payment_history", "expenses"], FAMILY);

    // ["audit_log"] appears ONCE even though both `payments` and `expenses`
    // carry it - every audited table shares that key by design.
    expect(keys).toEqual([
      ["payments", FAMILY],
      ["payment_history"],
      ["audit_log"],
      ["expenses", FAMILY],
    ]);
  });

  it("collapses tables that share one root key", () => {
    // A task change invalidates the flat task list AND the nested
    // lists-with-tasks select, so ["lists", familyId] must not be emitted twice
    // when the same window also carries a `lists` change.
    expect(invalidationKeysFor(["lists", "tasks"], FAMILY)).toEqual([
      ["lists", FAMILY],
      ["audit_log"],
      ["tasks", FAMILY],
    ]);
  });

  it("keeps the family-less payment_history key family-less", () => {
    // Deliberate: that cache is keyed by payment id as well as family + month.
    expect(invalidationKeysFor(["payment_history"], FAMILY)).toEqual([
      ["payments", FAMILY],
      ["payment_history"],
    ]);
  });

  it("ignores tables with no mapping and keeps the rest", () => {
    expect(invalidationKeysFor(["not_a_table", "events"], FAMILY)).toEqual([
      ["events", FAMILY],
      ["audit_log"],
    ]);
  });

  it("emits the shared audit key once for a burst across audited tables", () => {
    // Every one of the ten audited tables maps onto ["audit_log"], so a busy
    // window must not invalidate the open history panel once per table.
    const keys = invalidationKeysFor(["payments", "expenses", "tasks", "birthdays"], FAMILY);

    expect(keys.filter((k) => k[0] === "audit_log")).toHaveLength(1);
  });

  it("returns nothing for an empty window", () => {
    expect(invalidationKeysFor([], FAMILY)).toEqual([]);
  });

  it("takes a Set, which is what the flush actually hands it", () => {
    const pending = new Set(["events", "events", "birthdays"]);

    expect(invalidationKeysFor(pending, FAMILY)).toEqual([
      ["events", FAMILY],
      ["audit_log"],
      ["birthdays", FAMILY],
    ]);
  });
});
