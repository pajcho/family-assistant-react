import { describe, expect, it } from "vitest";

import { parseJournal } from "./parse.ts";
import { transliterateReceipt, transliterateToLatin } from "./transliterate.ts";

describe("transliterateToLatin — monographs", () => {
  it("maps the special Serbian letters", () => {
    expect(transliterateToLatin("Ђорђе")).toBe("Đorđe");
    expect(transliterateToLatin("ЂОРЂЕ")).toBe("ĐORĐE");
    expect(transliterateToLatin("жаба")).toBe("žaba");
    expect(transliterateToLatin("ШЕЋЕР")).toBe("ŠEĆER");
    expect(transliterateToLatin("чачак")).toBe("čačak");
  });

  it("transliterates a whole Cyrillic word", () => {
    expect(transliterateToLatin("МЛЕКО")).toBe("MLEKO");
    expect(transliterateToLatin("Београд")).toBe("Beograd");
    expect(transliterateToLatin("Београд-Чукарица")).toBe("Beograd-Čukarica");
  });
});

describe("transliterateToLatin — digraph casing rule", () => {
  it("uses title-case digraphs in mixed-case words", () => {
    expect(transliterateToLatin("Љубица")).toBe("Ljubica");
    expect(transliterateToLatin("Књига")).toBe("Knjiga");
    expect(transliterateToLatin("Џез")).toBe("Džez");
  });

  it("uses all-caps digraphs in all-caps words", () => {
    expect(transliterateToLatin("ЉУБИЦА")).toBe("LJUBICA");
    expect(transliterateToLatin("КЊИГА")).toBe("KNJIGA");
    expect(transliterateToLatin("ЏЕЗ")).toBe("DŽEZ");
  });

  it("uses lowercase digraphs in lowercase words", () => {
    expect(transliterateToLatin("љубица")).toBe("ljubica");
    expect(transliterateToLatin("џез")).toBe("džez");
    expect(transliterateToLatin("њива")).toBe("njiva");
  });
});

describe("transliterateToLatin — pass-through", () => {
  it("leaves Latin brand names, digits and punctuation unchanged", () => {
    expect(transliterateToLatin("NIKE Helanke g np tght W")).toBe("NIKE Helanke g np tght W");
    expect(transliterateToLatin("ZARA TC USCE")).toBe("ZARA TC USCE");
    expect(transliterateToLatin("1.234,56 RSD")).toBe("1.234,56 RSD");
    expect(transliterateToLatin("")).toBe("");
  });

  it("handles mixed Cyrillic + Latin in one string", () => {
    // Cyrillic words convert; the Latin token passes through.
    expect(transliterateToLatin("МАКСИ NIKE патике")).toBe("MAKSI NIKE patike");
  });
});

// End-to-end: a Cyrillic-merchant receipt must come out Latin everywhere.
const CYRILLIC_JOURNAL = `============ ФИСКАЛНИ РАЧУН ============
100123456
МАКСИ ДОО
1234567-МАКСИ ВОЖДОВАЦ
УЛИЦА ЊЕГОШЕВА 1
Београд-Вождовац
Артикли
========================================
Назив   Цена         Кол.         Укупно
100 МЛЕКО 1Л (Kom) (Ђ)
        99,99          2          199,98
Укупан износ:                     199,98
Готовина:                         199,98
ПФР време:          05.02.2026. 08:15:00
ПФР број рачуна: ABCDEFGH-ABCDEFGH-12345`;

describe("transliterateReceipt — end-to-end on a Cyrillic merchant", () => {
  const raw = parseJournal(CYRILLIC_JOURNAL);
  const latin = transliterateReceipt(raw);

  it("parses the Cyrillic journal (raw stays Cyrillic)", () => {
    expect(raw.storeName).toBe("МАКСИ ВОЖДОВАЦ");
    expect(raw.items[0].name).toBe("МЛЕКО 1Л");
  });

  it("returns every text field in Latin", () => {
    expect(latin.companyName).toBe("MAKSI DOO");
    expect(latin.storeName).toBe("MAKSI VOŽDOVAC");
    expect(latin.merchant).toBe("MAKSI VOŽDOVAC");
    expect(latin.items[0].name).toBe("MLEKO 1L");
  });

  it("leaves non-text fields untouched", () => {
    expect(latin.totalAmount).toBe(199.98);
    expect(latin.pib).toBe("100123456");
    expect(latin.issuedAt).toBe(raw.issuedAt);
  });
});
