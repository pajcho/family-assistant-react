import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJournal, parseReceiptHtml, parseSerbianAmount, ReceiptParseError } from "./parse.ts";
import { transliterateReceipt } from "./transliterate.ts";

// vitest runs with cwd = repo root; resolve the real captured fixtures from there.
const FIXTURE_DIR = join(process.cwd(), "supabase/functions/receipt-import/__fixtures__");

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

// Helper mirroring the Edge Function: parse the page HTML, then transliterate
// every text field to Latin (the shape the client + DB actually receive).
function parseHtmlToLatin(html: string) {
  return transliterateReceipt(parseReceiptHtml(html));
}

// ───────────────────────────────────────────────────────────────────────────
// Serbian number formats
// ───────────────────────────────────────────────────────────────────────────

describe("parseSerbianAmount", () => {
  it("parses dot-thousands + comma-decimal", () => {
    expect(parseSerbianAmount("1.234,56")).toBe(1234.56);
    expect(parseSerbianAmount("4.990,00")).toBe(4990);
    expect(parseSerbianAmount("1.000.000,00")).toBe(1000000);
    expect(parseSerbianAmount("831,67")).toBe(831.67);
    expect(parseSerbianAmount("20,00")).toBe(20);
  });

  it("handles the comma-less cases defensively", () => {
    expect(parseSerbianAmount("500")).toBe(500);
    expect(parseSerbianAmount("4990.00")).toBe(4990); // lone dot, 2 decimals → decimal
    expect(parseSerbianAmount("1.234")).toBe(1234); // lone dot, 3 trailing → thousands
  });

  it("returns null when nothing numeric is present", () => {
    expect(parseSerbianAmount("")).toBeNull();
    expect(parseSerbianAmount("abc")).toBeNull();
    expect(parseSerbianAmount("—")).toBeNull();
  });

  it("keeps a leading minus", () => {
    expect(parseSerbianAmount("-50,00")).toBe(-50);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// REAL captured pages (ground truth) — asserted through the Latin pipeline
// ───────────────────────────────────────────────────────────────────────────

describe("parseReceiptHtml — real ZARA capture", () => {
  const r = parseHtmlToLatin(fixture("zara.html"));

  it("reads the required fields", () => {
    expect(r.totalAmount).toBe(4990);
    expect(r.pib).toBe("103882837");
    expect(r.companyName).toBe("ITX RS");
    expect(r.storeName).toBe("ZARA TC USCE");
    expect(r.merchant).toBe("ZARA TC USCE"); // store name is not a code
    expect(r.issuedAt.slice(0, 10)).toBe("2026-01-13");
  });

  it("parses the single line item (name code + /kom (Ђ) stripped)", () => {
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      name: "BLEJZER",
      quantity: 1,
      unitPrice: 4990,
      total: 4990,
    });
    expect(r.warnings).toEqual([]);
  });
});

describe("parseReceiptHtml — real Planeta Sport capture", () => {
  const r = parseHtmlToLatin(fixture("planeta.html"));

  it("reads the required fields; falls back to company name when store is a code", () => {
    expect(r.totalAmount).toBe(7219.98);
    expect(r.pib).toBe("108540397");
    expect(r.companyName).toBe("PLANETA SPORT");
    expect(r.storeName).toBe("MPO 060"); // internal code
    expect(r.merchant).toBe("PLANETA SPORT"); // code-like store → company name
    expect(r.issuedAt.slice(0, 10)).toBe("2026-06-11");
  });

  it("parses 3 items incl. column-split names and a discounted line", () => {
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ name: "KESA S 05RN", total: 20 });
    // The NIKE name wraps across lines and "(Kom" splits — both parse identically.
    expect(r.items[1]).toMatchObject({
      name: "NIKE Helanke g np tght W",
      unitPrice: 4499.99,
      quantity: 1,
      total: 3599.99, // discount: line total ≠ price×qty, and total is authoritative
    });
    expect(r.items[2]).toMatchObject({ name: "NIKE Helanke g np tght W", total: 3599.99 });
    expect(r.warnings).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Synthetic journals — label variants the real captures don't cover
// ───────────────────────────────────────────────────────────────────────────

const CONVERSE_JOURNAL = `============ ФИСКАЛНИ РАЧУН ============
109876543
TRIPLE JUMP DOO
1227578-Converse Web Shop
БУЛЕВАР 1
Београд-Нови Београд
Артикли
========================================
Назив   Цена         Кол.         Укупно
371527C Chuck Taylor All Star Move /kom
(Ђ)
     6.990,00          1        6.990,00
За уплату:                      6.990,00
Пренос на рачун:                6.990,00
Повраћај:                           0,00
ПФР време           13.01.2026 19:41:58
ПФР број рачуна C5LBRBCW-C5LBRBCW-32186`;

describe('parseJournal — Converse "За уплату" + colon-less footer', () => {
  const r = parseJournal(CONVERSE_JOURNAL);

  it('takes the total from "За уплату", ignoring payment/change lines', () => {
    expect(r.totalAmount).toBe(6990);
  });

  it("parses the colon-less, trailing-dot-less PFR timestamp", () => {
    expect(r.issuedAt.slice(0, 10)).toBe("2026-01-13");
  });

  it("parses the wrapped item name (name / then (Ђ) on its own line)", () => {
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: "Chuck Taylor All Star Move", total: 6990 });
  });

  it("reads merchant identity", () => {
    expect(r.storeName).toBe("Converse Web Shop");
    expect(r.merchant).toBe("Converse Web Shop");
  });
});

const LATIN_JOURNAL = `============ FISKALNI RAČUN ============
111222333
LATIN SHOP DOO
9990-Latin Prodavnica
Ulica 1
Novi Sad
Artikli
========================================
Naziv   Cena         Kol.         Ukupno
55 PROIZVOD /kom (A)
     1.234,56          1        1.234,56
Ukupan iznos:                   1.234,56
Gotovina:                       1.234,56
PFR vreme:          10.03.2026. 14:22:00
PFR broj računa: LATIN123-LATIN123-999`;

describe("parseJournal — full Latin-script receipt", () => {
  const r = parseJournal(LATIN_JOURNAL);

  it("parses total, date, merchant and item from Latin labels", () => {
    expect(r.totalAmount).toBe(1234.56);
    expect(r.issuedAt.slice(0, 10)).toBe("2026-03-10");
    expect(r.storeName).toBe("Latin Prodavnica");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: "PROIZVOD", total: 1234.56 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Robustness contract
// ───────────────────────────────────────────────────────────────────────────

const BROKEN_ITEMS_JOURNAL = `============ ФИСКАЛНИ РАЧУН ============
100000001
TEST DOO
5550-TEST STORE
Adresa 1
Beograd
Артикли
========================================
Назив   Цена         Кол.         Укупно
??? nečitljiva stavka bez iznosa ???
Укупан износ:                     500,00
ПФР време:          01.01.2026. 10:00:00`;

describe("parseJournal — items best-effort", () => {
  it("keeps the total + adds a warning when items can't be read", () => {
    const r = parseJournal(BROKEN_ITEMS_JOURNAL);
    expect(r.totalAmount).toBe(500);
    expect(r.issuedAt.slice(0, 10)).toBe("2026-01-01");
    expect(r.items).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/[Ss]tavke/);
  });
});

/** Runs `fn` and returns the ReceiptParseError code it throws (or a marker). */
function parseErrorCode(fn: () => unknown): string {
  try {
    fn();
    return "did-not-throw";
  } catch (e) {
    return e instanceof ReceiptParseError ? e.code : "not-a-parse-error";
  }
}

describe("parseJournal — required fields throw typed errors", () => {
  it("throws no_total when the grand total is missing", () => {
    const j = `============ ФИСКАЛНИ РАЧУН ============
100000001
TEST DOO
5550-TEST STORE
ПФР време:          01.01.2026. 10:00:00`;
    expect(() => parseJournal(j)).toThrow(ReceiptParseError);
    expect(parseErrorCode(() => parseJournal(j))).toBe("no_total");
  });

  it("throws no_date when the timestamp is missing", () => {
    const j = `============ ФИСКАЛНИ РАЧУН ============
100000001
TEST DOO
5550-TEST STORE
Укупан износ:                     500,00`;
    expect(parseErrorCode(() => parseJournal(j))).toBe("no_date");
  });

  it("throws no_merchant when there is no merchant identity at all", () => {
    const j = `Укупан износ:                     100,00
ПФР време:          01.01.2026. 10:00:00`;
    expect(parseErrorCode(() => parseJournal(j))).toBe("no_merchant");
  });
});

describe("parseReceiptHtml — malformed page", () => {
  it("throws no_journal when no journal block is present", () => {
    expect(
      parseErrorCode(() => parseReceiptHtml("<html><body><p>ništa ovde</p></body></html>")),
    ).toBe("no_journal");
  });
});
