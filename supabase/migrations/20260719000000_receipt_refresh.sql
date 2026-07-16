-- "Osveži stavke" for receipts imported without line items (offline issuer,
-- journal pending — see the receipt-import PENDING-JOURNAL fallback). The
-- refresh re-fetches the SUF page through the same Edge Function; these are the
-- server-side guardrails so the re-fetch can't be spammed:
--
--   1. PER-RECEIPT cooldown — `expenses.receipt_checked_at`. The Edge Function
--      CLAIMS the timestamp atomically (UPDATE … WHERE stale RETURNING) BEFORE
--      fetching PURS, and 429s while it's fresh. The client reads the same
--      column to render a countdown, so users rarely even hit the 429. A family
--      member could reset the column through the normal RLS update path — the
--      global limit below is the backstop that actually protects the function.
--
--   2. GLOBAL per-user fixed window — `receipt_import_rate` + the
--      `bump_receipt_import_rate()` RPC, counted on EVERY receipt-import call
--      (scan and refresh alike). RLS is enabled with NO policies, so clients
--      can neither read nor reset it; only the SECURITY DEFINER RPC (and
--      service role) touch it. Limits are generous for humans (a receipt takes
--      ~30s to scan+save) and only bite scripted loops.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Per-receipt refresh cooldown claim.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS receipt_checked_at TIMESTAMP WITH TIME ZONE NULL;

-- Atomically claims the refresh cooldown for one receipt. SECURITY INVOKER on
-- purpose: RLS scopes the lookup to the caller's family, so a foreign/unknown
-- receipt URL is simply 'not_found'. A single conditional UPDATE makes
-- concurrent claims race safely (row lock; exactly one caller wins). Runs on
-- DB time — the Edge Function's clock never enters the comparison. (An RPC
-- instead of a PostgREST or= filter on UPDATE, which PostgREST rejects.)
CREATE OR REPLACE FUNCTION claim_receipt_refresh(p_receipt_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cooldown CONSTANT INTERVAL := INTERVAL '180 seconds';
  v_row RECORD;
BEGIN
  SELECT id, receipt_checked_at INTO v_row
  FROM expenses
  WHERE receipt_url = p_receipt_url;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE expenses
  SET receipt_checked_at = now()
  WHERE id = v_row.id
    AND (receipt_checked_at IS NULL OR receipt_checked_at < now() - v_cooldown);
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'claimed');
  END IF;

  RETURN jsonb_build_object(
    'status', 'too_soon',
    'retry_after_seconds', GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (COALESCE(v_row.receipt_checked_at, now()) + v_cooldown - now())))::INT
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION claim_receipt_refresh(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_receipt_refresh(TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Global per-user rate window for the receipt-import Edge Function.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE receipt_import_rate (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  calls INTEGER NOT NULL
);

-- No policies on purpose: nothing but the SECURITY DEFINER function below (and
-- the service role) may read or write the counters.
ALTER TABLE receipt_import_rate ENABLE ROW LEVEL SECURITY;

-- Atomically bumps the caller's counter and reports whether the call is within
-- the window budget. Single upsert = no read-then-write race under parallel
-- calls. Limits live here (not as arguments) so callers can't soften them.
CREATE OR REPLACE FUNCTION bump_receipt_import_rate()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max CONSTANT INTEGER := 20;                     -- calls…
  v_window CONSTANT INTERVAL := INTERVAL '10 min';  -- …per window
  v_calls INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO receipt_import_rate AS r (user_id, window_start, calls)
  VALUES (auth.uid(), now(), 1)
  ON CONFLICT (user_id) DO UPDATE SET
    calls = CASE WHEN now() - r.window_start > v_window THEN 1 ELSE r.calls + 1 END,
    window_start = CASE WHEN now() - r.window_start > v_window THEN now() ELSE r.window_start END
  RETURNING calls INTO v_calls;

  RETURN v_calls <= v_max;
END;
$$;

-- Callable only by signed-in members (the Edge Function invokes it with the
-- caller's JWT). Worst case of a direct client call: you burn your own budget.
REVOKE ALL ON FUNCTION bump_receipt_import_rate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bump_receipt_import_rate() TO authenticated;
