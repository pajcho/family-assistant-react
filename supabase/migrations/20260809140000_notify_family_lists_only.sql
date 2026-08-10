-- A personal list no longer pushes to the whole family.
--
-- Since 20260520250000_notify_on_create.sql, `notify_on_list_create` was FOR
-- EACH ROW with no condition at all, while `notify-on-create` sends to every
-- profile in the family (index.ts, a query on `profiles` by `family_id`) and
-- puts the entity name in the message body. So: a list with
-- `scope = 'personal'`, whose entire point is that others do not see it,
-- published its title on everyone's lock screen. RLS never allowed that (the
-- policy from 20260520200000_lists_feature.sql lets only the owner see a
-- personal list), and the header of the broadcast migration 20260729010000
-- explicitly assumes the same rule when it explains why the message does not
-- carry the whole row. The push path is the only one that never got it.
--
-- The condition sits in WHEN rather than in the function body: that way
-- `notify_family_on_entity_create` is unchanged (the triggers for events,
-- payments and birthdays share it), and a personal list does not spend a single
-- `net.http_post`.
--
-- Turning a personal list into a family one later is an UPDATE, not an INSERT,
-- so no push arrives for it - the same behaviour as before for any list that
-- already existed.

DROP TRIGGER IF EXISTS notify_on_list_create ON lists;

CREATE TRIGGER notify_on_list_create
  AFTER INSERT ON lists
  FOR EACH ROW
  WHEN (NEW.scope = 'family')
  EXECUTE FUNCTION notify_family_on_entity_create('list');
