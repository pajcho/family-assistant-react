-- One-time: clear stored per-calendar sync cursors so the next sync does a full
-- re-pull. The multi-day split shipped in 20260610000000 only runs as events
-- flow through the sync; incremental sync wouldn't re-touch already-mirrored
-- events, so existing multi-day events would stay single-row until edited.
-- Wiping the cursor forces one full window pull that re-expands them.
--
-- Deploy order matters: deploy the gcal functions BEFORE applying this migration,
-- so the forced re-pull runs on the new (multi-day) code against the new unique
-- constraint.

UPDATE google_calendars SET sync_token = NULL WHERE sync_token IS NOT NULL;
