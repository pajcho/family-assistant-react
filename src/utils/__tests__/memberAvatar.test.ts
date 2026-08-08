import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEMBER_AVATAR_STYLE,
  MEMBER_AVATAR_ANIMALS,
  MEMBER_AVATAR_AUTO_PALETTE,
  MEMBER_AVATAR_GROUPS,
  MEMBER_AVATAR_OTHER,
  MEMBER_AVATAR_PEOPLE,
  avatarForProfile,
  normalizeMemberAvatarStyle,
  resolveMemberAvatar,
} from "@/utils/memberAvatar";

/** Every tile the picker offers, across all groups. */
const ALL_CHOICES = MEMBER_AVATAR_GROUPS.flatMap((group) => group.emojis);

describe("avatarForProfile", () => {
  it("is stable for the same id", () => {
    const id = "0f2b4d6a-1111-2222-3333-444455556666";
    expect(avatarForProfile(id)).toBe(avatarForProfile(id));
  });

  it("spreads different ids across the palette", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `profile-${i}`);
    const distinct = new Set(ids.map(avatarForProfile));
    expect(distinct.size).toBeGreaterThan(8);
  });

  it("separates ids that differ only in a repeated character", () => {
    // Two siblings' seeded UUIDs used to collapse onto the same animal, because
    // only the low four bits pick it - that is what the finalizer fixes.
    expect(avatarForProfile("11111111-1111-1111-1111-111111111111")).not.toBe(
      avatarForProfile("22222222-2222-2222-2222-222222222222"),
    );
  });

  it("only ever returns something the picker also offers", () => {
    // Otherwise "automatski" would show a face you cannot then choose to keep.
    for (const emoji of MEMBER_AVATAR_AUTO_PALETTE) {
      expect(ALL_CHOICES).toContain(emoji);
    }
    const ids = Array.from({ length: 64 }, (_, i) => `p-${i}`);
    for (const id of ids) {
      expect(MEMBER_AVATAR_AUTO_PALETTE).toContain(avatarForProfile(id));
    }
  });

  it("does not move when the picker vocabulary grows", () => {
    // The auto palette is frozen on purpose: adding tiles to the picker must
    // never reshuffle the animal a member nobody picked for already wears.
    expect(MEMBER_AVATAR_AUTO_PALETTE).toHaveLength(16);
    expect(avatarForProfile("07bbb211-df0f-4609-a50c-c8e5c2a8a719")).toBe("🦄");
  });
});

describe("resolveMemberAvatar", () => {
  it("prefers the emoji a parent picked", () => {
    expect(resolveMemberAvatar({ id: "kid-1", avatar_emoji: "👦" })).toBe("👦");
  });

  it("falls back to the automatic animal when nothing is picked", () => {
    expect(resolveMemberAvatar({ id: "kid-1", avatar_emoji: null })).toBe(
      avatarForProfile("kid-1"),
    );
    expect(resolveMemberAvatar({ id: "kid-1" })).toBe(avatarForProfile("kid-1"));
  });

  it("treats a blank string as not picked, not as a blank tile", () => {
    expect(resolveMemberAvatar({ id: "kid-1", avatar_emoji: "   " })).toBe(
      avatarForProfile("kid-1"),
    );
  });

  it("uses the fallback id when the roster row has not arrived yet", () => {
    // MemberBadges renders straight from personIds - a member still loading has
    // to get their FINAL animal, or the tile would change under the user.
    expect(resolveMemberAvatar(undefined, "kid-1")).toBe(avatarForProfile("kid-1"));
    expect(resolveMemberAvatar(null, "kid-1")).toBe(avatarForProfile("kid-1"));
  });
});

describe("normalizeMemberAvatarStyle", () => {
  it("defaults to initials - colour carries meaning in the main app", () => {
    expect(DEFAULT_MEMBER_AVATAR_STYLE).toBe("initials");
    expect(normalizeMemberAvatarStyle(null)).toBe("initials");
    expect(normalizeMemberAvatarStyle(undefined)).toBe("initials");
    expect(normalizeMemberAvatarStyle("")).toBe("initials");
  });

  it("keeps a known value and rejects anything else", () => {
    expect(normalizeMemberAvatarStyle("emoji")).toBe("emoji");
    expect(normalizeMemberAvatarStyle("initials")).toBe("initials");
    expect(normalizeMemberAvatarStyle("EMOJI")).toBe("initials");
    expect(normalizeMemberAvatarStyle("faces")).toBe("initials");
  });
});

describe("the picker vocabulary", () => {
  it("offers three groups, animals first", () => {
    expect(MEMBER_AVATAR_GROUPS.map((g) => g.key)).toEqual(["animals", "people", "other"]);
  });

  it("is broad enough that a household does not run out of distinct faces", () => {
    // A dozen tiles puts two siblings one tap from the same face, which defeats
    // the point - the emoji is supposed to say WHICH member this is.
    expect(MEMBER_AVATAR_ANIMALS.length).toBeGreaterThanOrEqual(40);
    expect(MEMBER_AVATAR_PEOPLE.length).toBeGreaterThanOrEqual(15);
    // "Ostalo" stays a garnish, not a third full group.
    expect(MEMBER_AVATAR_OTHER.length).toBeLessThanOrEqual(12);
  });

  it("has no duplicate emoji, so no two tiles mean the same thing", () => {
    expect(new Set(ALL_CHOICES).size).toBe(ALL_CHOICES.length);
  });

  it("stays inside the column's 32-byte CHECK constraint", () => {
    // Multi-codepoint picks (👩‍🦰 and friends) are why that constraint counts
    // bytes rather than characters - this is the test that keeps us under it.
    const bytes = new TextEncoder();
    for (const emoji of ALL_CHOICES) {
      expect(bytes.encode(emoji).length).toBeLessThanOrEqual(32);
    }
  });
});
