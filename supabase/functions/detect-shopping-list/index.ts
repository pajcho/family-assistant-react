// supabase/functions/detect-shopping-list/index.ts
//
// Judges whether a list is a shopping list, from its name and a handful of its
// items, and stores Jev's probability on `lists.shopping_likelihood`. The app
// offers "Po rafovima" on a list judged to be one, and suggests switching to
// it once. The prompt and the rules live in ../_shared/shopCategories.ts.
//
//   • Called fire-and-forget by the client when a list grows while it is open,
//     never when one is merely viewed, so lists the family only reads (loans,
//     notes) are not sent anywhere until somebody writes to them.
//   • Runs on the caller's session, never the service role. RLS on `lists`
//     grants UPDATE exactly where it grants SELECT.
//   • Re-checks only once the list has doubled since the last judgement, and
//     that rule is enforced HERE, whatever the client sends, so at most log2(n)
//     model calls per list.
//   • Never fails the caller: a missing key, a Jev error or a malformed answer
//     leaves the list unjudged (no suggestion, no aisle option yet) and still
//     answers 200. Only a malformed request or a missing session is an error.
//   • A judgement-only write does not stamp the list or reorder the recents
//     (see 20260923085420_list_shopping_detection.sql).
//   • verify_jwt = true (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { callJev } from "../_shared/jev.ts";
import {
  buildShoppingListCheck,
  decideShoppingLikelihood,
  SHOPPING_LIST_THRESHOLD,
  shouldCheckShoppingList,
} from "../_shared/shopCategories.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JEV_TIMEOUT_MS = 5_000;
/** Items read for the judgement; the shared builder sends at most 15 of them. */
const ITEMS_READ = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);

  let listId: string;
  try {
    const body = (await req.json()) as { list_id?: unknown };
    if (typeof body.list_id !== "string" || !UUID.test(body.list_id)) throw new Error("list_id");
    listId = body.list_id;
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } } },
  );

  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id, name, smart_sort_enabled, shopping_likelihood, shopping_checked_items")
    .eq("id", listId)
    .maybeSingle();
  if (listError) {
    console.error("detect-shopping-list: reading the list failed", listError.message);
    return json({ checked: false, reason: "read_failed" });
  }
  // Not visible to this member (RLS), or gone.
  if (!list) return json({ checked: false, reason: "not_found" });

  // Already settled: aisles are on, or it is already known to be a shopping list.
  if (list.smart_sort_enabled || (list.shopping_likelihood ?? 0) >= SHOPPING_LIST_THRESHOLD) {
    return json({ checked: false, reason: "settled" });
  }

  const {
    data: items,
    count,
    error: itemsError,
  } = await supabase
    .from("tasks")
    .select("name", { count: "exact" })
    .eq("list_id", listId)
    .order("sort_order", { ascending: true })
    .limit(ITEMS_READ);
  if (itemsError) {
    console.error("detect-shopping-list: reading items failed", itemsError.message);
    return json({ checked: false, reason: "read_failed" });
  }
  const itemCount = count ?? items?.length ?? 0;

  // The real guard on cost: first at two items, then only once it has doubled.
  if (!shouldCheckShoppingList(itemCount, list.shopping_checked_items)) {
    return json({ checked: false, reason: "not_yet" });
  }

  const apiKey = Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) {
    console.warn("detect-shopping-list: TYPESAFE_API_KEY is not set, leaving the list unjudged");
    return json({ checked: false, reason: "not_configured" });
  }

  const request = buildShoppingListCheck(
    list.name,
    (items ?? []).map((row: { name: string }) => row.name),
  );
  const result = await callJev(apiKey, request, JEV_TIMEOUT_MS);
  if (!result.ok) {
    console.warn(`detect-shopping-list: Jev call failed (${result.reason})`);
    return json({ checked: false, reason: "model_unavailable" });
  }

  const likelihood = decideShoppingLikelihood(result.answers.is_shopping);
  if (likelihood === null) {
    console.warn("detect-shopping-list: Jev returned an unusable answer");
    return json({ checked: false, reason: "bad_answer" });
  }

  const { error: writeError } = await supabase
    .from("lists")
    .update({ shopping_likelihood: likelihood, shopping_checked_items: itemCount })
    .eq("id", listId);
  if (writeError) {
    console.warn("detect-shopping-list: write failed", writeError.message);
    return json({ checked: false, reason: "write_failed" });
  }

  return json({ checked: true, likelihood, shopping: likelihood >= SHOPPING_LIST_THRESHOLD });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
