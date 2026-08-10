import { describe, expect, it, vi } from "vitest";

import { type AccessRow, gateOnPin, MAX_PIN_ATTEMPTS } from "./gate.ts";
import { hashPin } from "../_shared/kidCrypto.ts";

// The gate runs against the real PBKDF2 from _shared/kidCrypto.ts (Deno-free,
// so Node's Web Crypto runs the exact code the edge function runs). The only
// stand-in is the Supabase client, faked below so every call it receives can be
// asserted on - in particular that a wrong PIN goes through the RPC and not
// through a read-modify-write.
//
// No timers are faked and nothing touches the network: `locked_until` is passed
// as an absolute timestamp relative to Date.now(), which is what the row holds.

/** One PIN the whole suite reuses - PBKDF2 at 100k iterations is not free. */
const PIN = "4821";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
  eq: [string, unknown];
}

/**
 * A Supabase client double covering exactly the two calls the gate makes:
 * `.rpc(fn, args)` and `.from(t).update(v).eq(c, v)`.
 */
function fakeAdmin(rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpcCalls: RpcCall[] = [];
  const updates: UpdateCall[] = [];

  const admin = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          return {
            eq(column: string, value: unknown) {
              updates.push({ table, values, eq: [column, value] });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };

  return { admin: admin as unknown as Parameters<typeof gateOnPin>[0], rpcCalls, updates };
}

async function makeAccess(overrides: Partial<AccessRow> = {}): Promise<AccessRow> {
  return {
    profile_id: "33333333-3333-3333-3333-333333333333",
    family_id: "11111111-1111-1111-1111-111111111111",
    auth_user_id: "44444444-4444-4444-4444-444444444444",
    login_email: "dete.test.deadbeef@porodica.local",
    pin_hash: await hashPin(PIN),
    is_enabled: true,
    theme: "ocean",
    failed_attempts: 0,
    locked_until: null,
    ...overrides,
  };
}

/** The gate answers in Responses; every assertion below reads the body. */
async function bodyOf(res: Response | null): Promise<Record<string, unknown>> {
  expect(res).not.toBeNull();
  return (await (res as Response).json()) as Record<string, unknown>;
}

describe("gateOnPin - live lockout", () => {
  it("short-circuits before any hash comparison", async () => {
    const { admin, rpcCalls, updates } = fakeAdmin({ data: null, error: null });
    const access = await makeAccess({
      locked_until: new Date(Date.now() + 600_000).toISOString(),
      // A correct PIN must NOT get in while the lock is live.
    });

    const res = await gateOnPin(admin, access, PIN);
    const body = await bodyOf(res);

    expect((res as Response).status).toBe(429);
    expect(body.code).toBe("locked");
    expect(body.retryAfterSeconds).toBe(600);
    expect(body.error).toBe("Previše pokušaja. Probaj ponovo za 10 minuta.");
    // Nothing was read or written: the lock is decided from the row in hand.
    expect(rpcCalls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("ignores a lockout that has already passed", async () => {
    const { admin, updates } = fakeAdmin({ data: null, error: null });
    const access = await makeAccess({
      failed_attempts: 3,
      locked_until: new Date(Date.now() - 1000).toISOString(),
    });

    expect(await gateOnPin(admin, access, PIN)).toBeNull();
    expect(updates).toHaveLength(1);
  });
});

describe("gateOnPin - correct PIN", () => {
  it("clears the counter and the stale lock", async () => {
    const { admin, rpcCalls, updates } = fakeAdmin({ data: null, error: null });
    const access = await makeAccess({ failed_attempts: 4 });

    expect(await gateOnPin(admin, access, PIN)).toBeNull();
    expect(rpcCalls).toEqual([]);
    expect(updates).toEqual([
      {
        table: "kid_access",
        values: { failed_attempts: 0, locked_until: null },
        eq: ["profile_id", access.profile_id],
      },
    ]);
  });

  it("writes nothing when there is nothing to clear", async () => {
    const { admin, updates } = fakeAdmin({ data: null, error: null });

    expect(await gateOnPin(admin, await makeAccess(), PIN)).toBeNull();
    expect(updates).toEqual([]);
  });
});

describe("gateOnPin - wrong PIN", () => {
  it("registers the failure through the RPC, never a read-modify-write", async () => {
    const { admin, rpcCalls, updates } = fakeAdmin({
      data: [{ failed_attempts: 1, locked_until: null }],
      error: null,
    });
    const access = await makeAccess();

    const body = await bodyOf(await gateOnPin(admin, access, "9999"));

    expect(rpcCalls).toEqual([
      {
        fn: "kid_register_pin_failure",
        args: {
          p_profile_id: access.profile_id,
          p_max_attempts: MAX_PIN_ATTEMPTS,
          p_lock_seconds: 900,
        },
      },
    ]);
    expect(updates).toEqual([]);
    expect(body.code).toBe("invalid_pin");
    expect(body.attemptsLeft).toBe(4);
    expect(body.error).toBe("Pogrešan PIN. Imaš još 4 pokušaja.");
  });

  it("counts from the row the database returns, not from the one it was handed", async () => {
    // The whole point of the RPC: a batch of simultaneous guesses all carry the
    // same stale `failed_attempts`, and only the database knows the real count.
    const { admin } = fakeAdmin({
      data: [{ failed_attempts: 4, locked_until: null }],
      error: null,
    });

    const body = await bodyOf(await gateOnPin(admin, await makeAccess(), "9999"));

    expect(body.attemptsLeft).toBe(1);
    expect(body.error).toBe("Pogrešan PIN. Imaš još 1 pokušaj.");
  });

  it("reports the lockout from locked_until, which the reset counter hides", async () => {
    // The lockout leg sets `locked_until` and puts the counter back to 0, so a
    // gate that branched on the count alone would answer "4 attempts left".
    const { admin } = fakeAdmin({
      data: [{ failed_attempts: 0, locked_until: new Date(Date.now() + 900_000).toISOString() }],
      error: null,
    });

    const res = await gateOnPin(admin, await makeAccess({ failed_attempts: 4 }), "9999");
    const body = await bodyOf(res);

    expect((res as Response).status).toBe(429);
    expect(body.code).toBe("locked");
    expect(body.retryAfterSeconds).toBe(900);
    expect(body.error).toBe("Previše pokušaja. Probaj ponovo za 15 minuta.");
  });

  it("accepts a bare object as well as PostgREST's array", async () => {
    const { admin } = fakeAdmin({ data: { failed_attempts: 2, locked_until: null }, error: null });

    expect((await bodyOf(await gateOnPin(admin, await makeAccess(), "9999"))).attemptsLeft).toBe(3);
  });
});

describe("gateOnPin - RPC unavailable", () => {
  it("still refuses the PIN and keeps the old answer shape", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, updates } = fakeAdmin({ data: null, error: { message: "PGRST202" } });

    const res = await gateOnPin(admin, await makeAccess({ failed_attempts: 1 }), "9999");
    const body = await bodyOf(res);

    expect((res as Response).status).toBe(401);
    expect(body.code).toBe("invalid_pin");
    expect(body.attemptsLeft).toBe(3);
    // No fallback write: duplicating the racy update is what this fix removes.
    expect(updates).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("locks rather than inventing an attempts-left of zero", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = fakeAdmin({ data: [], error: null });

    const res = await gateOnPin(admin, await makeAccess({ failed_attempts: 4 }), "9999");
    const body = await bodyOf(res);

    expect((res as Response).status).toBe(429);
    expect(body.code).toBe("locked");
    expect(body.retryAfterSeconds).toBe(900);
    spy.mockRestore();
  });
});
