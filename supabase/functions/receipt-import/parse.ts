// supabase/functions/receipt-import/parse.ts
//
// Pure parser for Serbian fiscal receipts (SUF / PURS). NO Deno APIs live here
// so the whole module can be imported straight into vitest and tested against
// the real captured HTML + synthetic journal fixtures (see parse.test.ts).
//
// The suf.purs.gov.rs/v/?vl=<token> verification page embeds the full receipt
// "journal" — a fixed-width (40-col) monospaced text block — inside
// `<pre style="font-family:monospace">…</pre>`, terminated by `<br/><img …>`
// (the QR image). We parse that journal, NOT the page's structured DOM labels:
// `totalAmountLabel` / `sdcDateTimeLabel` / `invoiceNumberLabel` / `tinLabel`
// are EMPTY in the server HTML (JS fills them client-side). The journal is the
// only server-rendered source of the numbers, and its layout is stable across
// retailers where the surrounding HTML is not.
//
// Robustness contract (enforced here):
//   • REQUIRED — totalAmount, issuedAt, and *some* merchant identity
//     (companyName | storeName | pib). Missing → typed ReceiptParseError; the
//     Edge Function maps it to a 422 + Serbian message.
//   • BEST-EFFORT — items. Item parsing is fully guarded: any failure yields an
//     empty `items` array plus a warning string, and NEVER fails the import.
//
// Real-retailer facts baked into the grammar (verified against ZARA/ITX and
// Planeta Sport captures, plus the paper Converse/Triple-Jump receipt):
//   • Total label varies: "Укупан износ" (ZARA/Planeta) vs "За уплату"
//     (Converse), plus Latin "Ukupan iznos"/"Za uplatu". Must NOT match
//     "Укупан износ пореза" (total *tax*). Payment lines ("Готовина",
//     "Платна картица", "Пренос на рачун") are ignored for the amount.
//   • Item block: header "Артикли", columns "Назив Цена Кол. Укупно". A name
//     line `<code> <name> <unit> (<taxmark>)` then an amounts line
//     `цена кол укупно`. Because wrapping is BY COLUMN (not word), the unit
//     token itself can split across lines ("(Kom" + ")") and the taxmark can
//     land on its own line. Unit varies: "/kom" (ZARA) vs "(Kom)" (Planeta).
//   • DISCOUNTS: the amounts line total may differ from price×qty
//     (4.499,99 × 1 → 3.599,99). The line TOTAL is authoritative; never derive.
//   • Numbers are Serbian: `1.234,56` (dot thousands, comma decimal).
//   • PFR footer labels appear with AND without a trailing colon. Timestamp is
//     `DD.MM.YYYY. HH:MM:SS` (trailing dot after the year).
//   • Header: `… ФИСКАЛНИ РАЧУН …`, PIB, company (may be Latin: "ITX RS",
//     "PLANETA SPORT"), then `<storeId>-<store name>`.

export interface ReceiptItem {
  name: string;
  /** Best-effort. NULL when the price×qty split couldn't be read. */
  quantity: number | null;
  /** Best-effort. NULL when the price×qty split couldn't be read. */
  unitPrice: number | null;
  /** Line total — always present for a parsed item, authoritative (discounts). */
  total: number;
}

export interface ParsedReceipt {
  /** Best display name: `storeName` unless it looks like an internal code
   *  ("MPO 060"), in which case `companyName`. Merchant→category memory key. */
  merchant: string | null;
  /** Legal company name (e.g. "ITX RS", "PLANETA SPORT"). */
  companyName: string | null;
  /** The `<storeId>-<name>` store label, name part only (e.g. "ZARA TC USCE"). */
  storeName: string | null;
  /** Tax id (PIB), digits only. */
  pib: string | null;
  /** ISO 8601 with the Europe/Belgrade offset, so the first 10 chars are the
   *  local receipt date (used verbatim for `expenses.spent_on`). */
  issuedAt: string;
  /** Grand total in RSD. */
  totalAmount: number;
  /** Best-effort line items (may be empty — see `warnings`). */
  items: ReceiptItem[];
  /** Non-fatal notes (Serbian, UI-facing). Empty on a fully-parsed receipt. */
  warnings: string[];
}

export type ReceiptParseErrorCode = "no_journal" | "no_total" | "no_date" | "no_merchant";

/** A fatal parse failure. The Edge Function turns this into a 422 + `.message`. */
export class ReceiptParseError extends Error {
  code: ReceiptParseErrorCode;
  constructor(code: ReceiptParseErrorCode, message: string) {
    super(message);
    this.name = "ReceiptParseError";
    this.code = code;
  }
}

// Serbian, UI-facing messages for the fatal cases.
const FATAL_MESSAGES: Record<ReceiptParseErrorCode, string> = {
  no_journal: "Nismo mogli da pročitamo račun sa stranice.",
  no_total: "Nismo mogli da pročitamo ukupan iznos sa računa.",
  no_date: "Nismo mogli da pročitamo datum sa računa.",
  no_merchant: "Nismo mogli da prepoznamo prodavca na računu.",
};

const ITEMS_WARNING = "Stavke nisu prepoznate — sačuvaćemo ukupan iznos.";

// ───────────────────────────────────────────────────────────────────────────
// Number parsing
// ───────────────────────────────────────────────────────────────────────────

/**
 * Parses a Serbian-formatted money string to a JS number.
 *   "1.234,56" → 1234.56   "4.990,00" → 4990   "831,67" → 831.67
 * Defensive about the comma-less case: a lone dot is a decimal only when it's a
 * single dot with 1–2 trailing digits ("4990.00"); otherwise dots are thousands
 * separators ("1.234" → 1234). Returns null when nothing numeric is present.
 */
export function parseSerbianAmount(raw: string): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(cleaned)) return null;

  const negative = cleaned.trimStart().startsWith("-");
  let s = cleaned.replace(/-/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma) {
    // Comma is the decimal separator; dots are thousands.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = s.split(".");
    // "4990.00" → decimal; "1.234" or "1.234.567" → thousands.
    if (!(parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2)) {
      s = s.replace(/\./g, "");
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Returns the last money-looking token on a line, parsed. Null when none. */
function lastAmountOnLine(line: string): number | null {
  const matches = line.match(/-?\d[\d.,]*/g);
  if (!matches || matches.length === 0) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = parseSerbianAmount(matches[i]);
    if (n != null) return n;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Date parsing (Europe/Belgrade)
// ───────────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Europe/Belgrade UTC offset (minutes east of UTC) at a UTC instant, via Intl
 * (standard ECMAScript — available in Deno and Node/vitest alike).
 */
function belgradeOffsetMinutes(atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Belgrade",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(atUtcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0; // some runtimes emit "24" at midnight
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - atUtcMs) / 60000);
}

/** ISO 8601 string with the correct Belgrade offset from local wall-clock parts. */
function belgradeIso(y: number, mo: number, d: number, hh: number, mm: number, ss: number): string {
  const approxUtc = Date.UTC(y, mo - 1, d, hh, mm, ss);
  const offMin = belgradeOffsetMinutes(approxUtc);
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const off = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:${pad2(ss)}${off}`;
}

/**
 * Finds the receipt timestamp from the "ПФР време" / "PFR vreme" footer line
 * (colon optional). Format: `DD.MM.YYYY. HH:MM:SS` (trailing year-dot optional,
 * seconds optional). Returns an ISO string or null.
 */
function findIssuedAt(lines: string[]): string | null {
  const dateTimeRe = /(\d{1,2})\.(\d{1,2})\.(\d{4})\.?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  const labelRe = /(пфр\s*врем|pfr\s*vrem)/i;
  let match: RegExpMatchArray | null = null;
  for (const line of lines) {
    if (labelRe.test(line)) {
      const m = line.match(dateTimeRe);
      if (m) {
        match = m;
        break;
      }
    }
  }
  if (!match) {
    for (const line of lines) {
      const m = line.match(dateTimeRe);
      if (m) {
        match = m;
        break;
      }
    }
  }
  if (!match) return null;
  const [, d, mo, y, hh, mm, ss] = match;
  return belgradeIso(Number(y), Number(mo), Number(d), Number(hh), Number(mm), ss ? Number(ss) : 0);
}

// ───────────────────────────────────────────────────────────────────────────
// Header (merchant identity)
// ───────────────────────────────────────────────────────────────────────────

function isSeparator(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  return /^[=_-]{3,}/.test(t) || /^[=_.\- ]+$/.test(t);
}

/**
 * Reads PIB, company name and store name from the header block that follows the
 * "ФИСКАЛНИ РАЧУН" / "FISKALNI RAČUN" banner.
 */
function parseHeader(lines: string[]): {
  pib: string | null;
  companyName: string | null;
  storeName: string | null;
} {
  const bannerIdx = lines.findIndex((l) => /(фискални\s*рачун|fiskalni\s*ra[čc]un)/i.test(l));
  const start = bannerIdx >= 0 ? bannerIdx + 1 : 0;

  let pib: string | null = null;
  let companyName: string | null = null;
  let storeName: string | null = null;

  const end = Math.min(lines.length, start + 12);
  for (let i = start; i < end; i++) {
    const line = lines[i].trim();
    if (!line || isSeparator(line)) continue;

    // Store label: `<storeId>-<store name>` (check before PIB so the leading
    // digits of the store id aren't mistaken for a PIB).
    if (storeName === null) {
      const storeM = line.match(/^\d{3,}\s*-\s*(.+)$/);
      if (storeM) {
        storeName = storeM[1].trim();
        continue;
      }
    }

    // PIB: a standalone 8–11 digit run (optional "ПИБ:" label).
    if (pib === null) {
      const pibM = line.match(/^(?:пиб\s*:?\s*)?(\d{8,11})\b/i);
      if (pibM) {
        pib = pibM[1];
        continue;
      }
    }

    // First non-numeric text line after the PIB is the company name.
    if (companyName === null && pib !== null && !/^\d/.test(line)) {
      companyName = line;
      continue;
    }
  }

  return { pib, companyName, storeName };
}

/**
 * Picks the friendliest merchant label. Prefers the store name, but store names
 * like "MPO 060" are internal codes — fall back to the company name for those.
 */
function pickMerchant(storeName: string | null, companyName: string | null): string | null {
  if (storeName) {
    // "MPO 060", "PJ 12", "MP-3" → code-like: short alpha prefix + number.
    const codeLike = /^[A-Za-zА-Яа-я]{1,4}[\s.-]?\d{1,6}$/.test(storeName.trim());
    if (!codeLike) return storeName;
  }
  return companyName ?? storeName ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Total
// ───────────────────────────────────────────────────────────────────────────

// The grand-total label, but NOT the tax-total ("… пореза" / "poreza", excluded
// via TAX_WORD_RE below). No trailing \b: JS word boundaries are ASCII-only, so
// \b never matches right after a Cyrillic letter like "износ".
const TOTAL_LABEL_RE = /^\s*(укупан\s*износ|ukupan\s*iznos|за\s*уплату|za\s*uplatu)/i;
const TAX_WORD_RE = /(порез|porez)/i;

function findTotal(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!TOTAL_LABEL_RE.test(line)) continue;
    if (TAX_WORD_RE.test(line)) continue; // skip "Укупан износ пореза"
    const amt = lastAmountOnLine(line);
    if (amt != null) return amt;
    if (i + 1 < lines.length) {
      const next = lastAmountOnLine(lines[i + 1]); // amount may have wrapped
      if (next != null) return next;
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Items (best-effort)
// ───────────────────────────────────────────────────────────────────────────

// A pure amounts line: 2–3 Serbian numbers, nothing else. Anchors each item.
const AMOUNTS_LINE_RE = /^\s*-?\d[\d.,]*(?:\s+-?\d[\d.,]*){1,2}\s*$/;

const ITEMS_HEADER_RE = /(артикли|artikli)/i;
const ITEMS_COLUMNS_RE = /(назив|naziv)/i;
const TAX_SECTION_RE = /(о[зж]нака|oznaka).*(стопа|stopa)/i;

/** Strips the product code prefix and the trailing unit/tax tokens from a name block. */
function cleanItemName(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // Strip a trailing tax mark: a 1–3 glyph token in parens, e.g. (Ђ) (Т) (А).
  s = s.replace(/\(\s*[^()\s]{1,3}\s*\)\s*$/, "").trim();
  // Strip a trailing unit token: /kom, (Kom), (kg), (kes)… (letters, ≤5, in
  // parens or slash-prefixed; tolerate the space left by a column-split ")" ).
  s = s.replace(/(?:\/\s*[A-Za-zА-Яа-яЂђ.]{1,6}|\(\s*[A-Za-zА-Яа-яЂђ.]{1,6}\s*\))\s*$/, "").trim();
  // Strip the leading product-code token — but ONLY when it looks like a code
  // (i.e. contains a digit): barcodes/PLUs like "0593646640103", "05RN",
  // "DA1028-010". Some retailers (e.g. Maxi/Delhaize) print NO code column, so
  // the line starts with the product name itself ("Snickers Classic 50g"); a
  // blind first-token strip there ate the first word ("Snickers" → "Classic").
  const lead = s.match(/^(\S+)\s+/);
  if (lead && /\d/.test(lead[1])) {
    s = s.slice(lead[0].length).trim();
  }
  return s;
}

function parseAmountsLine(line: string): {
  unitPrice: number | null;
  quantity: number | null;
  total: number;
} | null {
  const tokens = line.trim().split(/\s+/);
  const nums = tokens.map(parseSerbianAmount);
  if (nums.some((n) => n == null)) return null;
  const vals = nums as number[];
  if (vals.length === 3) return { unitPrice: vals[0], quantity: vals[1], total: vals[2] };
  if (vals.length === 2) return { unitPrice: vals[0], quantity: null, total: vals[1] };
  return null;
}

/**
 * Best-effort item extraction. The amounts line is the anchor: everything
 * accumulated since the previous anchor (code + possibly column-wrapped name +
 * a stray tax-mark line) is the name block.
 */
function parseItems(lines: string[]): ReceiptItem[] {
  const items: ReceiptItem[] = [];

  let start = lines.findIndex((l) => ITEMS_HEADER_RE.test(l));
  if (start < 0) start = lines.findIndex((l) => ITEMS_COLUMNS_RE.test(l));
  if (start < 0) return items;

  // Begin right after the "Назив Цена Кол. Укупно" column header.
  const headerIdx = lines.findIndex((l, idx) => idx > start && ITEMS_COLUMNS_RE.test(l));
  let i = headerIdx >= 0 ? headerIdx + 1 : start + 1;

  // End at the grand-total line (falling back to the tax section).
  let end = lines.findIndex((l, idx) => idx >= i && TOTAL_LABEL_RE.test(l) && !TAX_WORD_RE.test(l));
  if (end < 0) end = lines.findIndex((l, idx) => idx >= i && TAX_SECTION_RE.test(l));
  if (end < 0) end = lines.length;

  let buffer: string[] = [];
  for (; i < end; i++) {
    const line = lines[i];
    if (AMOUNTS_LINE_RE.test(line)) {
      const amounts = parseAmountsLine(line);
      const name = cleanItemName(buffer.join(" "));
      buffer = [];
      if (amounts && name) {
        items.push({
          name,
          quantity: amounts.quantity,
          unitPrice: amounts.unitPrice,
          total: amounts.total,
        });
      }
      continue;
    }
    if (isSeparator(line)) continue;
    buffer.push(line.trim());
  }

  return items;
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Parses a raw receipt journal (the monospaced text block) into structured
 * data. Throws ReceiptParseError when a REQUIRED field is missing; item parsing
 * is best-effort and only adds a warning on failure/empty.
 */
export function parseJournal(text: string): ParsedReceipt {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const warnings: string[] = [];

  const totalAmount = findTotal(lines);
  if (totalAmount == null) throw new ReceiptParseError("no_total", FATAL_MESSAGES.no_total);

  const issuedAt = findIssuedAt(lines);
  if (issuedAt == null) throw new ReceiptParseError("no_date", FATAL_MESSAGES.no_date);

  const { pib, companyName, storeName } = parseHeader(lines);
  const merchant = pickMerchant(storeName, companyName);
  if (!merchant && !pib) throw new ReceiptParseError("no_merchant", FATAL_MESSAGES.no_merchant);

  let items: ReceiptItem[] = [];
  try {
    items = parseItems(lines);
  } catch {
    items = [];
  }
  if (items.length === 0) warnings.push(ITEMS_WARNING);

  return { merchant, companyName, storeName, pib, issuedAt, totalAmount, items, warnings };
}

/** Decodes the handful of HTML entities that appear in SUF journal markup. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Pulls the journal text out of the SUF verification page HTML. The journal is
 * the monospaced <pre>; it ends with `<br/><img …>` (the QR image), so we cut
 * at the first <br>.
 */
function extractJournal(html: string): string | null {
  const preRe = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = preRe.exec(html)) !== null) {
    let inner = m[1];
    const br = inner.search(/<br\s*\/?>/i); // cut the trailing QR <img>
    if (br >= 0) inner = inner.slice(0, br);
    candidates.push(decodeEntities(inner));
  }
  const receiptLike = candidates.find((c) => /(фискални|fiskalni|пфр|pfr)/i.test(c));
  if (receiptLike) return receiptLike;
  if (candidates.length > 0) return candidates.reduce((a, b) => (b.length > a.length ? b : a));

  // No usable <pre>: try a <textarea> fallback.
  const ta = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
  if (ta) return decodeEntities(ta[1]);
  return null;
}

/**
 * Parses the full suf.purs.gov.rs verification page HTML: extracts the journal
 * and delegates to parseJournal. Throws ReceiptParseError("no_journal") when no
 * journal block can be located.
 */
export function parseReceiptHtml(html: string): ParsedReceipt {
  const journal = extractJournal(html);
  if (!journal || !/\S/.test(journal)) {
    throw new ReceiptParseError("no_journal", FATAL_MESSAGES.no_journal);
  }
  return parseJournal(journal);
}
