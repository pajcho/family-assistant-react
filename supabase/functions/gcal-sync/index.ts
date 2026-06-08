// supabase/functions/gcal-sync/index.ts
//
// Cron worker: mirrors events from every shared Google calendar
// (sharing != 'none') into external_calendar_events. Invoked by pg_cron with an
// X-Cron-Secret header (verify_jwt = false), the same pattern as send-due-pushes.
// The actual per-calendar sync lives in _shared/calendarSync.ts so gcal-calendars
// can reuse it for an immediate sync right after a calendar is shared.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CALENDAR_SELECT, syncOneCalendar, type SyncCalendarRow } from "../_shared/calendarSync.ts";

Deno.serve(async (req) => {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || req.headers.get("X-Cron-Secret") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: calendars, error } = await admin
    .from("google_calendars")
    .select(CALENDAR_SELECT)
    .neq("sharing", "none");
  if (error) console.error("gcal-sync calendars query failed:", error.message);

  const summary = { synced: 0, skipped: 0, reauth: 0, errors: 0 };
  for (const cal of (calendars ?? []) as unknown as SyncCalendarRow[]) {
    try {
      const outcome = await syncOneCalendar(admin, cal);
      summary[outcome]++;
    } catch (e) {
      summary.errors++;
      console.error(`gcal-sync calendar ${cal.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  return json({ ok: true, ...summary });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
