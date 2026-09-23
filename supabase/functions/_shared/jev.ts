// supabase/functions/_shared/jev.ts
//
// One call to Jev (TypeSafe's System One model), shared by categorize-tasks
// and detect-shopping-list. It never throws: every way a call can go wrong
// comes back as `ok: false`, because both callers must treat a failed call as
// "no answer, try again later" and never as a reason to fail the user.
//
// Only fetch and AbortController, no Deno globals, so vitest runs it as is.

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

export type JevResult =
  | { ok: true; answers: Record<string, unknown> }
  | {
      ok: false;
      /**
       * Every further call made with this key will fail the same way (a missing
       * or revoked key, an exhausted balance), so a batch should stop here.
       */
      fatal: boolean;
      reason: string;
    };

/**
 * Whether a Jev HTTP status means the key itself is unusable. Rate limits and
 * server errors are per-call and are deliberately not on this list.
 */
export function isFatalJevStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 403;
}

export async function callJev(
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<JevResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, fatal: isFatalJevStatus(res.status), reason: `status ${res.status}` };
    }
    const payload = (await res.json()) as { answers?: unknown };
    if (typeof payload.answers !== "object" || payload.answers === null) {
      return { ok: false, fatal: false, reason: "no answers in response" };
    }
    return { ok: true, answers: payload.answers as Record<string, unknown> };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? `timed out after ${timeoutMs} ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, fatal: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
