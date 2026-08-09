import type { CSSProperties } from "react";

/**
 * The emoji that stands for a family member, and how a viewer wants members
 * drawn.
 *
 * Two separate things, deliberately in one file because they only make sense
 * together (see the header of `20260808020000_member_avatar_emoji.sql`):
 *
 *   - `profiles.avatar_emoji` is a PROPERTY OF THE MEMBER - who this person
 *     is. A parent picks it in Porodica, next to the colour. NULL = not
 *     picked, and then `avatarForProfile` supplies a stable animal so nothing
 *     ever renders blank.
 *   - `profiles.member_avatar_style` is a SETTING OF THE VIEWER - whether I
 *     see members as initials or as emoji in MY main app. Per user, exactly
 *     like `accent`. The kid app ignores it: there the tile is big and a child
 *     reads a glyph faster than "AP".
 *
 * Lives in `utils/` rather than in `components/kid/` because both shells need
 * it and the main app has no business importing from the kid shell. Nothing
 * here touches React or Supabase, so tests can import it directly.
 *
 * Gender is neither stored nor guessed. In Serbian the only strong signal is
 * the `-a` ending for female names, and it fails on the most common male ones
 * (Nikola, Luka, Sava, Ilija, Aleksa, Andrija, Matija, Nemanja, Kosta), so a
 * guess would land wrong on a real family member. The parent picks instead -
 * and a child who would rather be a unicorn stays a unicorn.
 */

/** Values stored in `profiles.member_avatar_style`. English, because stored. */
export const MEMBER_AVATAR_STYLES = ["initials", "emoji"] as const;
export type MemberAvatarStyle = (typeof MEMBER_AVATAR_STYLES)[number];

/**
 * Initials, not emoji, when nothing is picked: in the main app the colour
 * carries meaning (it tints the same person's blocks in the weekly grid and
 * the calendar) and at badge size initials read faster.
 */
export const DEFAULT_MEMBER_AVATAR_STYLE: MemberAvatarStyle = "initials";

export function normalizeMemberAvatarStyle(raw: string | null | undefined): MemberAvatarStyle {
  if (!raw) return DEFAULT_MEMBER_AVATAR_STYLE;
  return (MEMBER_AVATAR_STYLES as readonly string[]).includes(raw)
    ? (raw as MemberAvatarStyle)
    : DEFAULT_MEMBER_AVATAR_STYLE;
}

/**
 * The animals, in the order a person scans them: pets and farm first (the ones
 * a small child names instantly), then the wild ones, birds, water, bugs.
 *
 * Deliberately long. This is the group children actually pick from, and a
 * dozen tiles means two siblings are one tap away from the same face - the
 * whole point is that a member's emoji says which member it is.
 */
export const MEMBER_AVATAR_ANIMALS: readonly string[] = [
  // Ljubimci i farma
  "🐶",
  "🐱",
  "🐭",
  "🐹",
  "🐰",
  "🐴",
  "🐮",
  "🐷",
  "🐑",
  "🐐",
  "🐔",
  "🐣",
  "🦆",
  // Šuma i divljina
  "🦊",
  "🐻",
  "🐼",
  "🐨",
  "🐯",
  "🦁",
  "🐵",
  "🦍",
  "🐺",
  "🦝",
  "🦔",
  "🦌",
  "🐗",
  "🦥",
  "🦘",
  "🐘",
  "🦒",
  "🦓",
  "🦛",
  // Ptice
  "🐦",
  "🐧",
  "🦉",
  "🦅",
  "🦜",
  "🦚",
  "🦩",
  // Voda
  "🐸",
  "🐢",
  "🐊",
  "🐬",
  "🐳",
  "🦈",
  "🐠",
  "🐟",
  "🐙",
  "🦑",
  "🦀",
  "🦞",
  "🦭",
  "🦦",
  // Bube
  "🐝",
  "🦋",
  "🐞",
  "🐌",
  "🐛",
  "🐜",
  "🦗",
  "🕷️",
];

/**
 * The people. Wide enough that a household of five does not end up as five
 * copies of the same face: three ages, a neutral figure at each of them, and
 * hair variations on the adults.
 *
 * No skin-tone modifiers. They would multiply this list sixfold for a choice
 * nobody asked to make in a picker their child also uses, and the plain glyphs
 * already carry the one thing the tile has to say - which member this is.
 */
export const MEMBER_AVATAR_PEOPLE: readonly string[] = [
  "👶",
  "🧒",
  "👦",
  "👧",
  "🧑",
  "👨",
  "👩",
  "🧔",
  "👱‍♂️",
  "👱‍♀️",
  "👨‍🦰",
  "👩‍🦰",
  "👨‍🦱",
  "👩‍🦱",
  "👨‍🦳",
  "👩‍🦳",
  "🧓",
  "👴",
  "👵",
];

/** The ones that are neither, kept short on purpose. */
export const MEMBER_AVATAR_OTHER: readonly string[] = [
  "🦄",
  "🐉",
  "🦖",
  "🦕",
  "🤖",
  "👽",
  "👻",
  "🧙",
];

export interface MemberAvatarGroup {
  key: string;
  label: string;
  emojis: readonly string[];
}

/** The picker's groups, in the order they are offered. */
export const MEMBER_AVATAR_GROUPS: readonly MemberAvatarGroup[] = [
  { key: "animals", label: "Životinje", emojis: MEMBER_AVATAR_ANIMALS },
  { key: "people", label: "Ljudi", emojis: MEMBER_AVATAR_PEOPLE },
  { key: "other", label: "Ostalo", emojis: MEMBER_AVATAR_OTHER },
];

/**
 * What "automatski" resolves to - a small, FIXED subset of the picker.
 *
 * Kept separate from the groups above so growing the vocabulary never reshuffles
 * anybody's automatic animal: a member nobody picked for keeps the face they
 * have always had, however many tiles the picker gains later. Every entry is
 * still offered in the picker, so switching from automatic to the same animal
 * changes nothing on screen.
 */
export const MEMBER_AVATAR_AUTO_PALETTE: readonly string[] = [
  "🦊",
  "🐼",
  "🐨",
  "🦁",
  "🐯",
  "🐸",
  "🐵",
  "🦉",
  "🐧",
  "🐰",
  "🐻",
  "🦄",
  "🐢",
  "🐝",
  "🦕",
  "🐬",
];

/**
 * Stable per-profile avatar - same person, same animal, on every device.
 *
 * FNV-1a plus an avalanche finalizer, rather than the `hash * 31` the rest of
 * the app uses for colours. The palette has 16 entries, so it is purely the LOW
 * FOUR BITS that pick the animal, and neither `* 31` nor FNV alone mixes those
 * enough: two sibling profiles came out as the same animal in testing. The
 * finalizer spreads the high bits back down, which is exactly the case it
 * exists for.
 */
export function avatarForProfile(profileId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < profileId.length; i += 1) {
    hash ^= profileId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash = (hash ^ (hash >>> 16)) >>> 0;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash = (hash ^ (hash >>> 15)) >>> 0;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return MEMBER_AVATAR_AUTO_PALETTE[hash % MEMBER_AVATAR_AUTO_PALETTE.length];
}

/** Everything the resolver needs off a profile row. */
export interface MemberAvatarSource {
  id: string;
  avatar_emoji?: string | null;
}

/**
 * The one place that decides which emoji a member wears: the picked one when
 * there is one, the deterministic animal otherwise.
 *
 * `fallbackId` is for the callers that hold an id but may not have the roster
 * row yet (`MemberBadges` renders straight from `personIds`) - a member who is
 * still loading gets their final automatic animal rather than a blank tile
 * that pops in.
 */
export function resolveMemberAvatar(
  member: MemberAvatarSource | null | undefined,
  fallbackId?: string | null,
): string {
  const picked = member?.avatar_emoji?.trim();
  if (picked) return picked;
  return avatarForProfile(member?.id ?? fallbackId ?? "");
}

/**
 * The emoji tile's wash. `color-mix` against `--card` rather than a fixed
 * alpha, so the tint lands on top of whatever layer it sits on and stays legible
 * in the dark theme instead of glowing.
 */
export function memberTintStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 20%, var(--card))`,
    borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
  };
}

/**
 * How many faces a member row draws for `count` members in `max` slots.
 * Exactly `max` members still fit as faces; past that the last slot is spent
 * on the "+N" chip, so "+1" can never appear - it would cost the space of the
 * one person it hides.
 */
export function visibleMemberCount(count: number, max: number): number {
  return count <= max ? count : Math.max(0, max - 1);
}
