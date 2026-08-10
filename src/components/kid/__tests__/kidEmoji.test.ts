import { describe, expect, it } from "vitest";

import { emojiForName, emojiForSubject, emojiForTaskName, foldSr } from "@/components/kid/kidEmoji";

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

describe("emojiForTaskName", () => {
  it("knows the household jobs a child is actually given", () => {
    expect(emojiForTaskName("Iznesi smeće")).toBe("🗑️");
    expect(emojiForTaskName("Pospremi sobu")).toBe("🧹");
    expect(emojiForTaskName("Nahrani mačku")).toBe("🐾");
    expect(emojiForTaskName("Operi sudove")).toBe("🍽️");
  });

  it("puts the chore vocabulary ahead of the activity one", () => {
    // "zubar" earns the dentist's chair; brushing your own teeth does not.
    expect(emojiForTaskName("Operi zube")).toBe("🪥");
    expect(emojiForName("Zubar - kontrola")).toBe("🦷");
  });

  it("still falls through to the activity words a chore can share", () => {
    expect(emojiForTaskName("Pročitaj lektiru")).toBe("📚");
    expect(emojiForTaskName("Trening pre škole")).toBe("🏃");
  });

  it("returns null when nothing matches, so the card falls back to its pin", () => {
    expect(emojiForTaskName("Nešto sasvim deseto")).toBeNull();
    expect(emojiForTaskName(null)).toBeNull();
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
