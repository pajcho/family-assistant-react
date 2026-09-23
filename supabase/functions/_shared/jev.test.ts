import { afterEach, describe, expect, it, vi } from "vitest";

import { callJev, isFatalJevStatus } from "./jev.ts";

/**
 * callJev is the whole fallback: both functions rely on it turning every
 * failure into `ok: false` instead of an exception, and on `fatal` telling a
 * dead key apart from a bad moment.
 */
function respond(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("callJev", () => {
  it("returns the answers of a good call", async () => {
    respond(200, { answers: { category: { choice: "dairy", confidence: 0.9 } } });
    expect(await callJev("key", {}, 1_000)).toEqual({
      ok: true,
      answers: { category: { choice: "dairy", confidence: 0.9 } },
    });
  });

  it("marks a dead key or an empty balance as fatal, so the batch stops", async () => {
    respond(402);
    expect(await callJev("key", {}, 1_000)).toMatchObject({ ok: false, fatal: true });
  });

  it("treats a rate limit or a server error as a bad moment, not a dead key", async () => {
    respond(429);
    expect(await callJev("key", {}, 1_000)).toMatchObject({ ok: false, fatal: false });
    respond(503);
    expect(await callJev("key", {}, 1_000)).toMatchObject({ ok: false, fatal: false });
  });

  it("gives up on a call that hangs instead of holding the function open", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      ),
    );
    const pending = callJev("key", {}, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ ok: false, fatal: false, reason: "timed out after 5000 ms" });
  });

  it("survives a network error and a response without answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await callJev("key", {}, 1_000)).toMatchObject({ ok: false, fatal: false });
    respond(200, { model: "jev-1.13" });
    expect(await callJev("key", {}, 1_000)).toMatchObject({ ok: false, fatal: false });
  });
});

describe("isFatalJevStatus", () => {
  it("is fatal only for a key or balance problem", () => {
    expect([401, 402, 403].every(isFatalJevStatus)).toBe(true);
    expect([400, 408, 429, 500, 503].some(isFatalJevStatus)).toBe(false);
  });
});
