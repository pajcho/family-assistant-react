// supabase/functions/notify-on-create/index.ts
//
// Triggered by AFTER INSERT on lists / events / payments / birthdays via
// pg_net (see migration 20260520250000_notify_on_create.sql). Fans out
// an instant push notification to every family member who has the
// matching opt-in enabled, except the actor who created the row.
//
// Auth: matches the send-due-pushes pattern. `verify_jwt = false` in
// config.toml (we set that alongside this function) so pg_net can call
// it without a user JWT; we authenticate via X-Cron-Secret instead.
//
// Idempotency: insert into `notification_log` keyed on (user_id, kind,
// ref_id) BEFORE sending. The UNIQUE constraint catches retries — if
// the row already exists, we skip the push. ref_id is the entity uuid
// so the same trigger firing twice for the same entity is deduped, but
// edits/re-inserts under a new id would notify again (correct).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

type EntityType = "list" | "event" | "payment" | "birthday";

interface NotifyRequest {
  entityType: EntityType;
  entityId: string;
  familyId: string;
  /** Author. `null` for service-role inserts; the function then notifies everyone. */
  actorId: string | null;
  /** Display name (e.g. list / event / payment name) — surfaced in the push body. */
  name: string;
}

interface PushSub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PreferenceRow {
  user_id: string;
  notify_on_list_create: boolean;
  notify_on_event_create: boolean;
  notify_on_payment_create: boolean;
  notify_on_birthday_create: boolean;
}

const PREF_KEY: Record<EntityType, keyof PreferenceRow> = {
  list: "notify_on_list_create",
  event: "notify_on_event_create",
  payment: "notify_on_payment_create",
  birthday: "notify_on_birthday_create",
};

const KIND_FOR: Record<EntityType, string> = {
  list: "list_create",
  event: "event_create",
  payment: "payment_create",
  birthday: "birthday_create",
};

const TITLE_FOR: Record<EntityType, string> = {
  list: "Nova lista",
  event: "Novi događaj",
  payment: "Novo plaćanje",
  birthday: "Novi rođendan",
};

const URL_FOR: Record<EntityType, (id: string) => string> = {
  list: (id) => `/lists/${id}`,
  event: () => "/events",
  payment: () => "/payments",
  birthday: () => "/birthdays",
};

Deno.serve(async (req) => {
  const cronHeader = req.headers.get("X-Cron-Secret");
  if (!CRON_SECRET || cronHeader !== CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: NotifyRequest;
  try {
    body = (await req.json()) as NotifyRequest;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.entityType || !body.entityId || !body.familyId || !body.name) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }
  if (!(body.entityType in PREF_KEY)) {
    return Response.json({ error: "unknown entityType" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Resolve actor name (for the push body). The actor row may not exist
  // if the insert came from a service-role connection — fall back to a
  // neutral phrasing in that case.
  let actorName = "";
  if (body.actorId) {
    const { data: actor } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", body.actorId)
      .maybeSingle();
    actorName = formatActorName(actor);
  }

  // All family members except the actor.
  const { data: members, error: membersError } = await supabase
    .from("profiles")
    .select("id")
    .eq("family_id", body.familyId);
  if (membersError) {
    return Response.json({ error: membersError.message }, { status: 500 });
  }
  const memberIds = ((members ?? []) as { id: string }[])
    .map((m) => m.id)
    .filter((id) => id !== body.actorId);
  if (memberIds.length === 0) {
    return Response.json({ ok: true, processed: 0, reason: "no recipients" });
  }

  // Look up each recipient's per-kind opt-in. Missing rows = use the
  // column defaults (all true) — we can't query for "default true"
  // directly, so we treat absence as opted in.
  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select(
      "user_id, notify_on_list_create, notify_on_event_create, notify_on_payment_create, notify_on_birthday_create",
    )
    .in("user_id", memberIds);
  const prefByUser = new Map<string, PreferenceRow>();
  for (const p of (prefs ?? []) as PreferenceRow[]) prefByUser.set(p.user_id, p);

  const prefKey = PREF_KEY[body.entityType];
  const kind = KIND_FOR[body.entityType];
  const title = TITLE_FOR[body.entityType];
  const url = URL_FOR[body.entityType](body.entityId);

  const optedIn = memberIds.filter((id) => {
    const p = prefByUser.get(id);
    return p ? p[prefKey] === true : true; // no row → defaults apply
  });

  if (optedIn.length === 0) {
    return Response.json({ ok: true, processed: 0, reason: "no opted-in members" });
  }

  const pushBody = actorName ? `${actorName} je dodao(la): ${body.name}` : body.name;
  const payload = JSON.stringify({
    title,
    body: pushBody,
    url,
    tag: `${kind}-${body.entityId}`,
  });

  const results: unknown[] = [];

  for (const userId of optedIn) {
    // Claim the (user, kind, entity) slot before sending so a retry of
    // the same trigger fire doesn't double-push.
    const { error: logError } = await supabase
      .from("notification_log")
      .insert({ user_id: userId, kind, ref_id: body.entityId });
    if (logError) {
      if (logError.code === "23505") {
        results.push({ user_id: userId, status: "already_sent" });
        continue;
      }
      results.push({ user_id: userId, error: logError.message });
      continue;
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    const subList = (subs ?? []) as PushSub[];

    if (subList.length === 0) {
      results.push({ user_id: userId, status: "no_subscriptions" });
      continue;
    }

    let sent = 0;
    let dead = 0;
    for (const sub of subList) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        // deno-lint-ignore no-explicit-any
        const status = (e as any)?.statusCode as number | undefined;
        if (status === 404 || status === 410) {
          // Subscription is dead — drop the row to avoid the round-trip
          // on every future notification.
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          dead++;
        }
      }
    }
    results.push({ user_id: userId, sent, dead });
  }

  return Response.json({ ok: true, kind, entity_id: body.entityId, processed: results });
});

function formatActorName(actor: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!actor) return "";
  const first = (actor.first_name ?? "").trim();
  const last = (actor.last_name ?? "").trim();
  if (first && last) return `${first} ${last}`;
  return first || last || "";
}
