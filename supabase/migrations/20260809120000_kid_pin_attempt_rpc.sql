-- kid_register_pin_failure - the missed-PIN counter in ONE statement.
--
-- Until now `kid-auth` read `failed_attempts` from a row loaded earlier, added
-- one in JS and wrote the ABSOLUTE value back. Two simultaneous attempts read
-- the same value and write the same result, so N parallel attempts cost ONE
-- strike. The function's own header says it is the lockout - not the hash -
-- that makes a four-digit PIN defensible, so what was weakened is exactly the
-- control the design leans on.
--
-- Here the read and the write happen inside one UPDATE: the second call waits
-- on the row lock, then after the first commits re-reads the FRESH value
-- (READ COMMITTED re-check) and adds its own one. The result is +2, not +1.
--
-- The semantics are deliberately identical to what came before:
--   * a miss that does NOT reach the threshold only increments the counter;
--   * a miss that reaches it sets `locked_until` and RESETS the counter to 0,
--     so the next window starts clean instead of locking on every further
--     attempt;
--   * an existing `locked_until` in the past is left alone (as before) - the
--     edge function evaluates that before calling anyway.
--
-- The threshold and the duration arrive as arguments so they stay where they
-- already live (MAX_PIN_ATTEMPTS / LOCKOUT_MINUTES in
-- supabase/functions/kid-auth/index.ts, mirrored by KID_MAX_PIN_ATTEMPTS in
-- src/types/kid.ts). The database still only stores state, as the column
-- comments in 20260808000000_kid_mode.sql say.

CREATE OR REPLACE FUNCTION public.kid_register_pin_failure(
  p_profile_id UUID,
  p_max_attempts INT,
  p_lock_seconds INT
)
RETURNS TABLE (failed_attempts SMALLINT, locked_until TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.kid_access AS k
     SET failed_attempts =
           CASE WHEN k.failed_attempts + 1 >= p_max_attempts
                THEN 0
                ELSE k.failed_attempts + 1
           END,
         locked_until =
           CASE WHEN k.failed_attempts + 1 >= p_max_attempts
                THEN now() + make_interval(secs => p_lock_seconds)
                ELSE k.locked_until
           END
   WHERE k.profile_id = p_profile_id
  RETURNING k.failed_attempts, k.locked_until;
$$;

COMMENT ON FUNCTION public.kid_register_pin_failure(UUID, INT, INT) IS
  'Records one missed PIN atomically and returns the state after the write. Called only by the kid-auth edge function with the service role.';

-- Service role only. `kid-auth` is the sole caller and uses the service role
-- key; a child or a guest has no business here - it would let them lock someone
-- else's account without a single sign-in attempt. The REVOKE has to name anon
-- and authenticated explicitly, because ALTER DEFAULT PRIVILEGES on the public
-- schema grants them EXECUTE at creation time (REVOKE FROM PUBLIC does not take
-- that away).
REVOKE ALL ON FUNCTION public.kid_register_pin_failure(UUID, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kid_register_pin_failure(UUID, INT, INT)
  TO service_role;
