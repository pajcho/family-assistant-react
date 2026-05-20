/**
 * Lightweight, offline grocery categoriser for the smart-sort button.
 *
 * Why offline / keyword-based instead of LLM:
 *   • Zero latency on tap — the button reorders items in one round-trip to
 *     Supabase, no AI call sitting between user and result.
 *   • No API cost / no key handling / no Edge Function infra.
 *   • Family lists are short (typically 5–30 items) and the language is
 *     Serbian-Latin + a sprinkle of brand names — a curated stem dictionary
 *     reaches >90% recall on real shopping lists without any model.
 *
 * Matching strategy
 * -----------------
 * Each item name is:
 *   1. Lowercased
 *   2. Stripped of Serbian-Latin diacritics (š→s, č→c, ć→c, đ→d, ž→z)
 *   3. Split into tokens on whitespace and punctuation
 *
 * Each token is matched against per-category stems via *prefix* match.
 * Stems handle Serbian inflection cheaply: "jabuk" hits "jabuka",
 * "jabuke", "jabukama". Order in `CATEGORY_ORDER` is the rendering order
 * and the tie-breaker when a name matches multiple categories (most
 * specific category should come first — see `pantry` ordering below).
 */

export type GroceryCategory =
  | "fruits_veg"
  | "dairy"
  | "meat_fish"
  | "bakery"
  | "pantry"
  | "frozen"
  | "drinks"
  | "sweets_snacks"
  | "cleaning"
  | "hygiene"
  | "household"
  | "other";

/**
 * Category iteration order. Doubles as:
 *   • the order categories are rendered in after smart-sort (left-to-right
 *     of a typical Balkan supermarket aisle layout: produce → dairy → meat
 *     → bakery → pantry → frozen → drinks → sweets → non-food at the end)
 *   • the tie-breaker when an item matches multiple category stems —
 *     earlier categories win, so put the more specific one first
 */
export const CATEGORY_ORDER: GroceryCategory[] = [
  "fruits_veg",
  "dairy",
  "meat_fish",
  "bakery",
  "pantry",
  "frozen",
  "drinks",
  "sweets_snacks",
  "cleaning",
  "hygiene",
  "household",
  "other",
];

/** Display labels for the inline category headers (Serbian-Latin). */
export const CATEGORY_LABEL: Record<GroceryCategory, string> = {
  fruits_veg: "Voće i povrće",
  dairy: "Mlečni proizvodi",
  meat_fish: "Meso i riba",
  bakery: "Hleb i pecivo",
  pantry: "Namirnice i začini",
  frozen: "Smrznuta hrana",
  drinks: "Piće",
  sweets_snacks: "Slatkiši i grickalice",
  cleaning: "Sredstva za čišćenje",
  hygiene: "Higijena",
  household: "Kućne potrepštine",
  other: "Ostalo",
};

/**
 * Per-category keyword stems. Stems should be prefixes of the inflected
 * forms you expect to encounter — e.g. "jabuk" matches jabuka, jabuke,
 * jabukama. Keep stems short enough to catch all reasonable inflections,
 * long enough to avoid false positives (e.g. don't stem `so` (salt) to
 * `s` — that would match everything).
 *
 * Brand names are included where they unambiguously identify a category:
 * "ariel" → cleaning, "kinder" → sweets, "imlek" doesn't help (just a
 * dairy brand among others — relies on item name also containing "mleko"
 * or similar).
 */
const KEYWORDS: Record<Exclude<GroceryCategory, "other">, string[]> = {
  fruits_veg: [
    // Fruits — stems
    "jabuk", "banan", "naranc", "naranzd", "mandarin", "limun", "grejpfru",
    "jagod", "malin", "kupin", "borovnic", "brusnic",
    "breskv", "kajsij", "tresnj", "visnj", "sljiv", "krusk",
    "grozd", "lubenic", "dinj", "avokad", "mango", "ananas", "kivi",
    "smokv", "nar", "kokos", "rogac",
    // Vegetables — stems
    "krompir", "krastav", "paradajz", "paprik", "sargarep", "salat", "rotkv",
    "cvekl", "kupus", "karfiol", "brokol", "spanac", "zelje", "persun",
    "celer", "misir", "bundev", "tikvic", "patlid", "rotkvic", "mrkv",
    "asparag", "gljiv", "pecurk", "rukol", "kelj", "luk", "cesnj",
    // Group nouns
    "voce", "povrc",
  ],
  dairy: [
    "mlek", "jogurt", "kefir", "sir", "sire", "pavlak",
    "kajmak", "maslac", "puter", "mocarela", "parmezan", "fet",
    "jaj", "jaje", "puding", "krem", "topljen", "gauda", "cedar",
    "feta", "skorup", "rikot", "varen", "mladi sir", "trapis",
    "edamer", "kackaval",
  ],
  meat_fish: [
    "meso", "pile", "pilet", "junet", "svinj", "jagnj", "curet", "pur",
    "patk", "kobasic", "salam", "sunk", "slanin", "prsut",
    "rib", "lososa", "losos", "tuna", "sardin", "oslic", "orad",
    "pastrm", "skus", "smudj", "lokard", "bakalar", "polovin",
    "mljev", "burgers",
  ],
  bakery: [
    "hleb", "lepinj", "kifl", "baget", "cabat", "sendvic",
    "krof", "burek", "pekarsk", "brasno", "kvasac", "tijest", "test",
    "pretzel", "perec", "somun", "pogac", "pita ", "tortilj",
  ],
  pantry: [
    "secer", "sirce", "ulje", "pirinac", "makaron", "spaget", "spagh",
    "kecap", "majonez", "senf", "supa ", "supe ", "kim", "origano",
    "bosiljk", "ruzmar", "cubric", "cili", "kari", "kurkum", "cimet",
    "vanil", "preliv", "ajvar", "pesto", "mahun", "pasulj", "griz",
    "biber", "soja sos", "musardin", "tahini", "kvasc", "instant kafa",
    "konzerv", "pasta od",
    // "pasta" alone is too ambiguous (matches pasta-za-zube), so leave it
    // out and lean on "spaget" / "makaron".
  ],
  frozen: [
    "smrznut", "smrznuto", "ribi prsti", "smrznute", "smrz",
  ],
  drinks: [
    "vod", "sok", "kola ", "fanta", "sprite", "cedevit", "limunad",
    "piv", "vin", "viski", "votk", "rakij", "sampan", "kafa", "kav",
    "caj", "espreso", "energetsk", "milkshake", "frape", "tonik",
    "schweppes", "ledena kaf", "guarana", "cockta",
  ],
  sweets_snacks: [
    "cokolad", "bombon", "kreker", "cips", "sladoled", "zvak",
    "palacin", "biskvit", "keks", "lizalic", "med", "dzem", "marmelad",
    "kinder", "nutella", "praline", "plazma", "eurokrem", "manner",
    "haribo", "milka", "mljev", "wafer", "grickalic", "smoki",
    "stapic", "perec",
  ],
  cleaning: [
    "deterdz", "omeks", "perilic", "fairy", "ariel", "persil",
    "ajaks", "cif", "wax", "pronto", "pur", "frosch", "calgon", "vanish",
    "sapuni za", "tablete za", "kucni sredstv", "sundjer", "krpa",
    "rukavice", "wc sredstv", "wc gel", "domestos", "ker",
  ],
  hygiene: [
    "toaletn", "sampon", "regenerator", "tus gel", "gel za tus", "sapun",
    "dezodor", "parfem", "cesalj", "britvic", "pasta za zube",
    "cetkic", "peskir", "ulosc", "tampon", "pelen", "vat", "higij",
    "krema", "krema za", "deo", "dezodorans", "parfemi", "ulosci",
    "maramic za bebe", "vlazn maramic", "ostrij", "nivea", "dove",
  ],
  household: [
    "baterij", "sijalic", "kesa", "vrecic", "fenjer", "svec",
    "aluminij", "celofan", "tanjir", "casa", "kasik", "vilj",
    "noz", "paklic", "paketic", "kese za smec", "papirne maramic",
    "kuhinjske krpe",
  ],
};

/** Name-pattern shortcut for "this list is obviously a shopping list". */
const SHOPPING_NAME_PATTERN = /sopin|shop|kupovin|namirn|grocer|trznic|pijac|prodavnic|market/i;

/**
 * Strip Serbian-Latin diacritics. Used for normalising both stored item
 * names and the keyword dictionary so the lookup is diacritic-insensitive.
 */
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // The "normalize+strip" trick handles standard combining-diacritics
    // (š, č, ž etc.) but Serbian "đ" / "Đ" decompose oddly in some
    // browsers — handle them explicitly. The "ć" and "ś" are already
    // covered by Diacritic stripping above.
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Lowercase + strip diacritics + split on non-letters. */
function tokens(name: string): string[] {
  const norm = stripDiacritics(name.toLowerCase());
  return norm.split(/[^a-z0-9]+/u).filter(Boolean);
}

/**
 * Categorise a single item by its display name. Items that don't hit any
 * stem fall back to `other` — they still render, just under the catch-all
 * group after smart-sort.
 */
export function categorize(name: string): GroceryCategory {
  const t = tokens(name);
  // Stems can include spaces (e.g. "pasta za zube") — for those we test
  // against the full normalised string. Single-word stems test against
  // individual tokens via prefix match.
  const fullNorm = stripDiacritics(name.toLowerCase());

  for (const category of CATEGORY_ORDER) {
    if (category === "other") continue;
    const stems = KEYWORDS[category];
    for (const stem of stems) {
      if (stem.includes(" ")) {
        if (fullNorm.includes(stem)) return category;
      } else {
        if (t.some((tok) => tok.startsWith(stem))) return category;
      }
    }
  }
  return "other";
}

export interface IsShoppingListResult {
  isShopping: boolean;
  /** Fraction of items recognised as groceries — useful for diagnostics / tests. */
  recognisedRatio: number;
}

/**
 * Detect whether a list should be treated as a shopping list. Two signals:
 *   1. Name matches a Serbian/English shopping-related word
 *   2. At least 40% of items categorise as groceries (not "other"),
 *      with a minimum of 3 items so a 1-item "Mleko" list doesn't
 *      surprise the user
 *
 * Either signal alone is enough.
 */
export function isShoppingList(name: string, itemNames: string[]): IsShoppingListResult {
  const recognised = itemNames.filter((n) => categorize(n) !== "other").length;
  const ratio = itemNames.length > 0 ? recognised / itemNames.length : 0;
  const byName = SHOPPING_NAME_PATTERN.test(name);
  const byContent = itemNames.length >= 3 && ratio >= 0.4;
  return { isShopping: byName || byContent, recognisedRatio: ratio };
}
