-- "What did my partner just add?" for tasks.
--
-- The fifth kind for `notify-on-create` (20260520250000_notify_on_create.sql),
-- next to list, event, payment and birthday: an AFTER INSERT trigger fires
-- pg_net at the edge function, which reads each recipient's per-kind opt-in and
-- fans out over web-push. Default true, like the other four, so it works out of
-- the box for anyone who already turned notifications on and opts OUT per kind
-- from the settings page.
--
-- A PERSONAL task must not notify the family. `notify-on-create` sends to every
-- profile in the family and puts the entity's name in the body, so without the
-- condition a task whose entire point is that nobody else sees it would publish
-- its title on everybody's lock screen. That is the exact bug
-- 20260809140000_notify_family_lists_only.sql fixed for personal lists, and the
-- condition lives in WHEN for the same two reasons: `notify_family_on_entity_
-- create` stays untouched (four other triggers share it), and a personal task
-- does not spend a single `net.http_post`.
--
-- `tasks.scope` is trustworthy here without looking at the parent list, because
-- set_task_defaults() forces a listed task's scope to its list's scope on
-- INSERT, before this AFTER trigger runs.
--
-- Making a personal task family later is an UPDATE, not an INSERT, so no push
-- arrives for it - the same behaviour lists have had since 20260809140000.
--
-- ONLY A DATED TASK PUSHES. A plain shopping-list item is now a task too, so a
-- bare `scope = 'family'` condition would fire ten pushes for ten items dropped
-- into the groceries list, where today it fires none (lists only push when the
-- LIST is created). `due_date IS NOT NULL` is the honest line: a push means
-- "this just landed on somebody's Danas", which is exactly what a date makes
-- true and what its absence makes false. An undated item in a list stays as
-- quiet as it is today, and an undated standalone task - an Inbox capture -
-- stays quiet as well, because nobody needs waking for a thought somebody
-- parked. Giving a task a date later is an UPDATE, so it does not push either;
-- that matches how every other kind here behaves.
--
-- The matching edge function change (a `task` entity type, and the list
-- deep-link moving from /lists/<id> to /tasks/<id>) MUST ship in the same
-- release as the route rename, or every new push opens a 404.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_on_task_create BOOLEAN NOT NULL DEFAULT true;

DROP TRIGGER IF EXISTS notify_on_task_create ON tasks;

CREATE TRIGGER notify_on_task_create
  AFTER INSERT ON tasks
  FOR EACH ROW
  WHEN (NEW.scope = 'family' AND NEW.due_date IS NOT NULL)
  EXECUTE FUNCTION notify_family_on_entity_create('task');
