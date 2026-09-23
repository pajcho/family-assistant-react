// supabase/functions/categorize-tasks/index.ts
//
// Files shopping-list items into shop departments with Jev and stores the
// answer on `tasks.category`. The client calls this fire-and-forget whenever a
// smart-sorted list shows items that are not filed yet; the prompt and the
// decision rule live in ../_shared/shopCategories.ts.
//
//   • Runs entirely on the caller's session, never the service role. RLS on
//     `tasks` grants UPDATE under exactly the condition it grants SELECT, so a
//     member can file precisely the items they can see, and there is no
//     privileged path whose checks could drift from the policies.
//   • It must never be the reason an item cannot be added, so it never fails
//     loudly. A missing key, an exhausted balance, a timeout or a malformed
//     answer all leave the row NULL, which the app shows under "Ostalo" and
//     asks about again on a later visit. Those cases still answer 200 with
//     counts; only a malformed request or a missing session is an error.
//   • The write is guarded on the name that was classified and on the category
//     still being NULL, so a rename (which clears it in the database) or a
//     second device filing the same item cannot be overwritten by a stale answer.
//   • A category-only write does not stamp `updated_by_id`/`updated_at` or bump
//     the parent list (see 20260923081240_task_category.sql), so filing is not
//     credited to whoever happened to open the list.
//   • verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { callJev } from "../_shared/jev.ts";
import { buildJevRequest, decideCategory } from "../_shared/shopCategories.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** One visit's worth; the client chunks anything bigger. */
const MAX_TASKS_PER_CALL = 50;
/** Jev answers in 70-500 ms. Past this the item is simply left for next time. */
const JEV_TIMEOUT_MS = 5_000;
const JEV_CONCURRENCY = 6;
/** Siblings are read once per list; more than this adds cost, not accuracy. */
const MAX_LIST_ROWS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TaskRow {
  id: string;
  name: string;
  list_id: string;
  lists: { name: string; smart_sort_enabled: boolean } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);

  let taskIds: string[];
  try {
    const body = (await req.json()) as { task_ids?: unknown };
    if (!Array.isArray(body.task_ids)) throw new Error("task_ids");
    taskIds = [...new Set(body.task_ids)].filter(
      (id): id is string => typeof id === "string" && UUID.test(id),
    );
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (taskIds.length === 0) return json({ filed: 0, unfiled: 0 });
  if (taskIds.length > MAX_TASKS_PER_CALL) return json({ error: "too_many_tasks" }, 400);

  // Checked before any database read, so an unconfigured environment costs one
  // cheap request and nothing else.
  const apiKey = Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) {
    console.warn("categorize-tasks: TYPESAFE_API_KEY is not set, leaving items unfiled");
    return json({ filed: 0, unfiled: taskIds.length, reason: "not_configured" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } } },
  );

  // RLS filters to what this member can see; items already filed (by another
  // device, say) and items outside a smart-sorted list are skipped.
  const { data: rows, error: readError } = await supabase
    .from("tasks")
    .select("id, name, list_id, lists!inner(name, smart_sort_enabled)")
    .in("id", taskIds)
    .is("category", null);
  if (readError) {
    console.error("categorize-tasks: reading tasks failed", readError.message);
    return json({ filed: 0, unfiled: taskIds.length, reason: "read_failed" });
  }
  const pending = ((rows ?? []) as unknown as TaskRow[]).filter(
    (row) => row.lists?.smart_sort_enabled,
  );
  if (pending.length === 0) return json({ filed: 0, unfiled: 0 });

  // Sibling names per list, read once however many of its items are pending.
  const siblingsByList = new Map<string, { id: string; name: string }[]>();
  for (const listId of new Set(pending.map((row) => row.list_id))) {
    const { data } = await supabase
      .from("tasks")
      .select("id, name")
      .eq("list_id", listId)
      .order("sort_order", { ascending: true })
      .limit(MAX_LIST_ROWS);
    siblingsByList.set(listId, (data ?? []) as { id: string; name: string }[]);
  }

  let filed = 0;
  let stopped = false;

  await runPool(pending, JEV_CONCURRENCY, async (task) => {
    if (stopped) return;

    const siblings = (siblingsByList.get(task.list_id) ?? [])
      .filter((row) => row.id !== task.id)
      .map((row) => row.name);
    const request = buildJevRequest(task.name, task.lists?.name ?? "", siblings);

    const result = await callJev(apiKey, request, JEV_TIMEOUT_MS);
    if (!result.ok) {
      // Key revoked or balance gone: every remaining call would fail the same
      // way, so stop instead of spending the batch on rejections.
      if (result.fatal) stopped = true;
      console.warn(`categorize-tasks: Jev call failed (${result.reason})`);
      return;
    }

    const decision = decideCategory(result.answers.category);
    if (!decision) return;

    const { error } = await supabase
      .from("tasks")
      .update({ category: decision.category, category_confidence: decision.confidence })
      .eq("id", task.id)
      .eq("name", task.name)
      .is("category", null);
    if (error) {
      console.warn("categorize-tasks: write failed", error.message);
      return;
    }
    filed += 1;
  });

  return json({ filed, unfiled: pending.length - filed });
});

/** Run `task` over `items` with at most `size` in flight. */
async function runPool<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index]);
    }
  });
  await Promise.all(workers);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
