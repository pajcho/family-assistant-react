/**
 * supabase-js wraps every non-2xx Edge Function response in a generic
 * `FunctionsHttpError` whose `message` is just "Edge Function returned a
 * non-2xx status code". The real server message is on the raw `Response`
 * exposed via `error.context`. Pull it out so callers can surface something
 * actionable (e.g. "email already in use") instead of the wrapper string.
 *
 * Shared by the email-change flow in Settings and the family-login hooks.
 */
export async function readFunctionsError(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: Response | unknown }).context;
  if (!ctx || typeof (ctx as Response).json !== "function") return null;
  try {
    const body = (await (ctx as Response).json()) as { error?: unknown };
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}
