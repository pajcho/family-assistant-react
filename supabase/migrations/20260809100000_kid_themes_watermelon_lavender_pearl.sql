-- Three new kid themes: watermelon, lavender and pearl (5 -> 8).
--
-- The keys are English, like all the others: 'watermelon', 'lavender', 'pearl'.
-- Serbian exists only as the label in the app (KID_THEME_OPTIONS in
-- src/types/kid.ts).
--
-- The theme list lives in TWO places in the database, and both have to be
-- widened together: the CHECK on `kid_access.theme` and the body of
-- `public.kid_set_theme`. If only the CHECK were widened, the RPC would still
-- reject the new keys as an unknown theme; if only the function body were, the
-- UPDATE inside it would fail on the CHECK. Nothing is removed from the set, so
-- there is no data migration either.

-- ---------------------------------------------------------------------------
-- 1. The CHECK on the column
-- ---------------------------------------------------------------------------
-- The constraint was written inline in CREATE TABLE in
-- 20260808000000_kid_mode.sql, so Postgres named it `kid_access_theme_check`
-- itself. Here we drop it and put it back under the same name, so the next
-- migration like this has something to find.
ALTER TABLE kid_access DROP CONSTRAINT IF EXISTS kid_access_theme_check;

ALTER TABLE kid_access
  ADD CONSTRAINT kid_access_theme_check
  CHECK (theme IN ('ocean', 'jungle', 'sun', 'candy', 'watermelon', 'lavender', 'pearl', 'space'));

-- ---------------------------------------------------------------------------
-- 2. kid_set_theme - the only write a kid session may perform
-- ---------------------------------------------------------------------------
-- The definition from 20260808000000_kid_mode.sql, rewritten with only the list
-- in the IF changed. The reason this is an RPC and not an UPDATE policy is
-- explained there: a policy would cover the WHOLE row, so a child could
-- overwrite `pin_hash` or `is_enabled`.
CREATE OR REPLACE FUNCTION public.kid_set_theme(p_theme TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_theme IS NULL OR p_theme NOT IN (
    'ocean', 'jungle', 'sun', 'candy', 'watermelon', 'lavender', 'pearl', 'space'
  ) THEN
    RAISE EXCEPTION 'Unknown theme: %', p_theme USING ERRCODE = '22023';
  END IF;

  UPDATE public.kid_access
    SET theme = p_theme
    WHERE auth_user_id = auth.uid()
      AND is_enabled;
END;
$$;

COMMENT ON FUNCTION public.kid_set_theme(TEXT) IS
  'Changes the calling child''s theme. The only write a kid session may perform.';

-- CREATE OR REPLACE keeps the existing grants, but we repeat them so the
-- function is locked down correctly even when this migration is applied to a
-- database without the previous one.
REVOKE ALL ON FUNCTION public.kid_set_theme(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_set_theme(TEXT) TO authenticated;
