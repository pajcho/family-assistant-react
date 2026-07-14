// supabase/functions/receipt-import/index.ts
//
// Fetches a Serbian fiscal-receipt verification page (suf.purs.gov.rs/v/?vl=…),
// parses its journal into structured data, transliterates every text field to
// Serbian Latin, and returns it. The function does NO database work — the client
// previews the result and then saves it through the normal `expenses` insert
// path so RLS + mutations stay uniform (see useReceiptImport / useExpenses).
//
// verify_jwt = true (see supabase/config.toml): called from the client with the
// member's session, so the platform rejects unauthenticated calls before we run.
//
// SSRF guard: we ONLY ever fetch https://suf.purs.gov.rs/v/… — protocol, exact
// host and path prefix are all validated before the outbound fetch, so this
// endpoint can't be turned into a proxy for arbitrary URLs.
//
// The parser + transliterator live in sibling pure modules parse.ts /
// transliterate.ts (no Deno APIs) so vitest exercises them directly.

import { parseReceiptHtml, ReceiptParseError } from "./parse.ts";
import { transliterateReceipt } from "./transliterate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_HOST = "suf.purs.gov.rs";
const ALLOWED_PATH_PREFIX = "/v/";
const FETCH_TIMEOUT_MS = 10_000;
// A browser-ish UA — the PURS page has been known to vary its output for
// obvious bots. Keep it plausible without impersonating a specific version.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface Body {
  url?: unknown;
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

  const validation = validateReceiptUrl(body.url);
  if ("error" in validation) return json({ error: validation.error }, 400);
  const target = validation.url;

  // ── Fetch the verification page (bounded, SSRF-safe target) ────────────────
  let html: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "sr,en;q=0.8",
      },
    });
    if (!res.ok) {
      return json({ error: `Nismo mogli da učitamo račun (status ${res.status}).` }, 502);
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return json({ error: "Učitavanje računa je isteklo. Pokušaj ponovo." }, 504);
    }
    return json({ error: "Nismo mogli da se povežemo sa poreskom stranicom." }, 502);
  } finally {
    clearTimeout(timer);
  }

  // ── Parse + transliterate to Latin ─────────────────────────────────────────
  try {
    const receipt = transliterateReceipt(parseReceiptHtml(html));
    return json({ receipt: { ...receipt, receiptUrl: target } }, 200);
  } catch (err) {
    if (err instanceof ReceiptParseError) {
      return json({ error: err.message, code: err.code }, 422);
    }
    return json({ error: "Neočekivana greška pri obradi računa." }, 500);
  }
});

type UrlValidation = { url: string } | { error: string };

/** SSRF guard + input validation for the incoming receipt URL. */
function validateReceiptUrl(raw: unknown): UrlValidation {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "Nedostaje link računa." };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: "Link računa nije ispravan." };
  }
  if (parsed.protocol !== "https:") {
    return { error: "Link mora počinjati sa https." };
  }
  // Exact host match (not endsWith) so e.g. "suf.purs.gov.rs.evil.com" is rejected.
  if (parsed.hostname !== ALLOWED_HOST) {
    return { error: "Link mora biti sa suf.purs.gov.rs." };
  }
  if (!parsed.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    return { error: "Link računa nije ispravan." };
  }
  return { url: parsed.toString() };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
