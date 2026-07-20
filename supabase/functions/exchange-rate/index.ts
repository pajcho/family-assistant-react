// supabase/functions/exchange-rate/index.ts
//
// Official NBS (Narodna banka Srbije) middle exchange rate for one
// (currency, date) pair, cache-first. The client asks for a rate only while a
// member is ENTERING a foreign-currency expense; the resolved rate is then
// frozen into the expense row (expenses.exchange_rate), so history is never
// re-converted and this endpoint is never on any read path.
//
//   • Cache: `exchange_rates` (PK date+currency), read/written with the
//     service role. Members have SELECT-only RLS and can never write rates —
//     a user session cannot poison the cache.
//   • Upstream on miss: kurs.resenje.org, a public JSON API over the official
//     NBS list. Weekend/holiday dates return the last published list with
//     HTTP 200 (`date_from` < requested date), so no walk-back is needed.
//     The unit middle rate is `exchange_middle / parity` (parity is 1 for EUR;
//     some currencies are listed per 100 units).
//   • verify_jwt = true (config.toml): only signed-in members can call this.
//     The date range is clamped (2003-01-01 .. tomorrow) and every resolved
//     pair caches, so a given date hits the upstream at most once per currency.
//     The one-day forward slack covers Belgrade being ahead of server UTC
//     around midnight; the upstream answers near-future dates with the latest
//     list, same as weekends.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Extend together with EXPENSE_CURRENCIES on the client (src/utils/currency.ts).
const SUPPORTED_CURRENCIES = new Set(["EUR", "USD", "CHF", "GBP"]);
// NBS switched to the current list format in 2003; older dates 404 upstream.
const MIN_DATE = "2003-01-01";
const FETCH_TIMEOUT_MS = 8_000;

interface Body {
  currency?: unknown;
  date?: unknown;
}

interface UpstreamRate {
  exchange_middle?: number;
  parity?: number;
  date_from?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // verify_jwt=true already gates this, but require the header explicitly too.
  if (!req.headers.get("Authorization")) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Neispravan zahtev." }, 400);
  }

  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
  if (!SUPPORTED_CURRENCIES.has(currency)) return json({ error: "Nepodržana valuta." }, 400);

  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return json({ error: "Neispravan datum." }, 400);
  }
  const maxDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (date < MIN_DATE || date > maxDate) return json({ error: "Datum je van opsega." }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: cached } = await admin
    .from("exchange_rates")
    .select("rate, source_date")
    .eq("date", date)
    .eq("currency", currency)
    .maybeSingle();
  if (cached) {
    return json({ rate: Number(cached.rate), source_date: cached.source_date, currency, date });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream: UpstreamRate;
  try {
    const res = await fetch(
      `https://kurs.resenje.org/api/v1/currencies/${currency.toLowerCase()}/rates/${date}`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return json({ error: `Kurs za ${date} nije dostupan (status ${res.status}).` }, 502);
    }
    upstream = (await res.json()) as UpstreamRate;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return json({ error: "Preuzimanje kursa je isteklo. Pokušaj ponovo." }, 504);
    }
    return json({ error: "Nismo mogli da se povežemo sa servisom kursne liste." }, 502);
  } finally {
    clearTimeout(timer);
  }

  const middle = typeof upstream.exchange_middle === "number" ? upstream.exchange_middle : NaN;
  const parity = typeof upstream.parity === "number" && upstream.parity > 0 ? upstream.parity : 1;
  if (!(middle > 0)) return json({ error: "Neispravan odgovor servisa kursne liste." }, 502);

  const rate = Math.round((middle / parity) * 1e6) / 1e6;
  const sourceDate = typeof upstream.date_from === "string" ? upstream.date_from : date;

  // Best-effort cache: the caller still gets the rate if this write fails.
  await admin.from("exchange_rates").upsert({ date, currency, rate, source_date: sourceDate });

  return json({ rate, source_date: sourceDate, currency, date });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
