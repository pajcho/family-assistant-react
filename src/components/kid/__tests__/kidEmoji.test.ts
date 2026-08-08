import { describe, expect, it } from "vitest";

import { emojiForName, emojiForSubject, foldSr } from "@/components/kid/kidEmoji";

/**
 * The glyph tiles are how a child tells one card from another before reading
 * it, so the matcher has to survive real Serbian: diacritics, inflections and
 * whatever capitalisation a parent happened to type.
 */

describe("foldSr", () => {
  it("lowercases and folds the five Serbian letters", () => {
    expect(foldSr("Fizičko")).toBe("fizicko");
    expect(foldSr("ĆIRILICA šđž")).toBe("cirilica sdjz");
  });
});

describe("emojiForName", () => {
  it("matches regardless of case and diacritics", () => {
    expect(emojiForName("Trening - FUDBAL")).toBe("⚽");
    expect(emojiForName("muzička škola")).toBe("🎵");
    expect(emojiForName("Zubar - kontrola")).toBe("🦷");
  });

  it("matches on a stem, so inflections still land", () => {
    expect(emojiForName("Plivanje")).toBe("🏊");
    expect(emojiForName("Idemo na plivanju")).toBe("🏊");
    expect(emojiForName("Ekskurzija - Tara")).toBe("🚌");
  });

  it("returns null when nothing matches, so the caller can fall back", () => {
    expect(emojiForName("Nešto sasvim deseto")).toBeNull();
    expect(emojiForName("")).toBeNull();
    expect(emojiForName(null)).toBeNull();
  });
});

describe("emojiForSubject", () => {
  it("knows the school subjects", () => {
    expect(emojiForSubject("Matematika")).toBe("➗");
    expect(emojiForSubject("Srpski jezik")).toBe("📚");
    expect(emojiForSubject("Fizičko vaspitanje")).toBe("⚽");
    expect(emojiForSubject("Priroda i društvo")).toBe("🌍");
  });

  it("always resolves - an unknown subject still gets a book", () => {
    expect(emojiForSubject("Nepoznat predmet")).toBe("📘");
    expect(emojiForSubject(null)).toBe("📘");
  });

  it("does not confuse fizika with fizicko", () => {
    expect(emojiForSubject("Fizika")).toBe("🔭");
    expect(emojiForSubject("Fizičko")).toBe("⚽");
  });
});
