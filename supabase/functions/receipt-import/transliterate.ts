// supabase/functions/receipt-import/transliterate.ts
//
// Serbian Cyrillic → Serbian Latin (Gajica) transliteration. Pure module, no
// Deno APIs - vitest imports it directly.
//
// The SUF journal arrives in Cyrillic (brand names may already be Latin). The
// owner wants every stored receipt field in Latin, so the Edge Function runs
// each parser-returned text field through `transliterateToLatin` before
// returning it (client preview + saved rows are Latin end-to-end).
//
// Digraph casing rule (the only subtle part): Љ/Њ/Џ become "Lj"/"Nj"/"Dž"
// normally, but "LJ"/"NJ"/"DŽ" when the surrounding WORD is all-caps -
// "ЉУБИЦА" → "LJUBICA" but "Љубица" → "Ljubica". We decide per word: a word is
// all-caps when it equals its uppercase form and differs from its lowercase.
// Non-Cyrillic characters (Latin brands like ZARA/NIKE, digits, punctuation)
// pass through unchanged.

import type { ParsedReceipt } from "./parse.ts";

// Single-letter (monograph) mapping, both cases. Digraphs (Љ/Њ/Џ) are handled
// separately because their Latin casing depends on the word.
const MONO: Record<string, string> = {
  А: "A",
  Б: "B",
  В: "V",
  Г: "G",
  Д: "D",
  Ђ: "Đ",
  Е: "E",
  Ж: "Ž",
  З: "Z",
  И: "I",
  Ј: "J",
  К: "K",
  Л: "L",
  М: "M",
  Н: "N",
  О: "O",
  П: "P",
  Р: "R",
  С: "S",
  Т: "T",
  Ћ: "Ć",
  У: "U",
  Ф: "F",
  Х: "H",
  Ц: "C",
  Ч: "Č",
  Ш: "Š",
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  ђ: "đ",
  е: "e",
  ж: "ž",
  з: "z",
  и: "i",
  ј: "j",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  ћ: "ć",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "č",
  ш: "š",
};

function transliterateWord(word: string): string {
  // A word is "all-caps" when it has cased letters and none are lowercase.
  const allCaps = word === word.toUpperCase() && word !== word.toLowerCase();
  let out = "";
  for (const ch of word) {
    if (ch === "Љ" || ch === "Њ" || ch === "Џ") {
      const title = ch === "Љ" ? "Lj" : ch === "Њ" ? "Nj" : "Dž";
      // "Lj".toUpperCase() === "LJ"; "Dž".toUpperCase() === "DŽ".
      out += allCaps ? title.toUpperCase() : title;
    } else if (ch === "љ" || ch === "њ" || ch === "џ") {
      out += ch === "љ" ? "lj" : ch === "њ" ? "nj" : "dž";
    } else {
      out += MONO[ch] ?? ch;
    }
  }
  return out;
}

/** Transliterates Serbian Cyrillic to Latin, word by word (for digraph casing). */
export function transliterateToLatin(text: string): string {
  if (!text) return text;
  return text.replace(/\p{L}+/gu, (word) => transliterateWord(word));
}

/** Returns a copy of the parsed receipt with every text field transliterated. */
export function transliterateReceipt(parsed: ParsedReceipt): ParsedReceipt {
  const tl = (s: string | null): string | null => (s == null ? s : transliterateToLatin(s));
  return {
    ...parsed,
    merchant: tl(parsed.merchant),
    companyName: tl(parsed.companyName),
    storeName: tl(parsed.storeName),
    items: parsed.items.map((it) => ({ ...it, name: transliterateToLatin(it.name) })),
    // pib / issuedAt / totalAmount are non-text; warnings are authored in Latin.
  };
}
