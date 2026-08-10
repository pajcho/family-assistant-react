-- An emoji avatar per family member, plus a choice of how members are shown.
--
-- Two columns, two different things - do not confuse them:
--
--   avatar_emoji         A PROPERTY OF THE MEMBER. The emoji that stands for
--                        that person. A parent picks it on the family screen,
--                        next to the colour.
--   member_avatar_style  A VIEWER SETTING. Whether I, in my own app, see
--                        members as coloured initials or as emoji.
--
-- Why gender is neither stored nor guessed: in Serbian the only strong signal
-- is the -a ending for feminine, and the most common male names fall foul of it
-- (Nikola, Luka, Sava, Ilija, Aleksa, Andrija, Matija, Nemanja, Kosta), so a
-- miss would hit a specific family member. Hence an explicit choice instead of
-- a guess - and along the way a child may be a unicorn if they want, which is
-- rather the point of the kid app.
--
-- A NULL avatar_emoji = not chosen. The kid app then still shows the
-- deterministic animal derived from profiles.id (avatarForProfile), so nothing
-- is blank until somebody picks. Hence NULL rather than a default value: "not
-- chosen" and "chosen to be exactly this" have to be distinguishable.
--
-- member_avatar_style is deliberately PER USER, like `accent`: one parent can
-- look at initials while the other looks at emoji, with no effect on anyone
-- else. It defaults to 'initials' because in the main app the colour carries
-- meaning (it is what tints activities in the week grid and the calendar), and
-- at badge size initials read faster than emoji. The kid app does NOT look at
-- this setting - there it is always emoji, because the tile is large and a
-- child does not read initials well.
--
-- Writing to both columns is covered by the existing RLS policy "Users can
-- update own profile" (for yourself) or the admin policy (for members without
-- a login).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_emoji TEXT;

-- Short, but not measured in characters: a single emoji can be several code
-- points (ZWJ sequences, skin-tone modifiers), so the bound is set in bytes so
-- no legitimate choice is rejected. The CHECK only keeps junk out of the
-- database on a direct write; the client picks from a fixed list.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_avatar_emoji_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_avatar_emoji_check
  CHECK (avatar_emoji IS NULL OR octet_length(avatar_emoji) BETWEEN 1 AND 32);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS member_avatar_style TEXT;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_member_avatar_style_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_member_avatar_style_check
  CHECK (member_avatar_style IS NULL OR member_avatar_style IN ('initials', 'emoji'));

COMMENT ON COLUMN profiles.avatar_emoji IS
  'The emoji that stands for this member. NULL = not chosen, falls back to the deterministic animal derived from the id.';
COMMENT ON COLUMN profiles.member_avatar_style IS
  'How THIS user sees members in the main app. NULL = initials. The kid app ignores this.';
