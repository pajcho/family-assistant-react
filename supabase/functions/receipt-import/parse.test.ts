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

describe("parseReceiptHtml — real NIS capture (offline device, journal pending)", () => {
  // Gas-station automat receipt: PURS verified it but the issuer hasn't synced
  // the journal yet, so the page has NO <pre> at all. Required fields come from
  // the server-rendered #PrintInvoice block instead.
  const r = parseHtmlToLatin(fixture("nis-pending-journal.html"));

  it("falls back to the print block for the required fields", () => {
    expect(r.totalAmount).toBe(6817.35);
    expect(r.pib).toBe("104052135");
    expect(r.companyName).toBe("NIS A.D. NOVI SAD");
    expect(r.storeName).toBe("BS Žarkovo 2");
    expect(r.merchant).toBe("BS Žarkovo 2");
    expect(r.issuedAt.slice(0, 10)).toBe("2026-07-16");
  });

  it("imports without items and explains why via a warning", () => {
    expect(r.items).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/nije poslao sadržaj računa/);
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

// A Maxi/Delhaize receipt: the name column has NO leading product code, so the
// product name starts the line. Regression guard for the "first word dropped"
// bug ("Snickers Classic 50g" → "Classic 50g", "Krompir beli mladi" → "beli
// mladi"). Item names on these receipts are already Latin.
const MAXI_JOURNAL = `============ ФИСКАЛНИ РАЧУН ============
101482858
DELHAIZE SERBIA DOO BEOGRAD
1002011-116-Maxi
ЛУКЕ ВОЈВОДИЋА 77А
Београд-Раковица
Артикли
========================================
Назив   Цена         Кол.         Укупно
Snickers Classic 50g/KOM (Ђ)
     93,99          1          93,99
Krompir beli mladi/KG (E)
     89,99      2,518        226,59
Укупан износ:                    320,58
Платна картица:                  320,58
ПФР време:          15.07.2026. 18:36:44
ПФР број рачуна: VX7EBVLA-VX7EBVLA-33649`;

describe("parseJournal — Maxi receipt with no product-code column", () => {
  const r = parseJournal(MAXI_JOURNAL);

  it("keeps the first word when the line starts with the name, not a code", () => {
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      name: "Snickers Classic 50g",
      quantity: 1,
      unitPrice: 93.99,
      total: 93.99,
    });
    expect(r.items[1]).toMatchObject({
      name: "Krompir beli mladi",
      quantity: 2.518,
      unitPrice: 89.99,
      total: 226.59,
    });
    expect(r.warnings).toEqual([]);
  });

  it("still reads merchant identity + total", () => {
    expect(r.totalAmount).toBe(320.58);
    expect(r.storeName).toBe("116-Maxi");
    expect(r.merchant).toBe("116-Maxi");
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
