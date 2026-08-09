// supabase/functions/_shared/kidCrypto.ts
//
// PIN hashing, token generation and the synthetic-address builder for kid mode -
// deliberately free of any Deno global or network import, so it stays
// unit-testable in plain Node/Vitest (see kidCrypto.test.ts). Everything here
// runs on the Web Crypto API, which both Deno and Node 22 expose as `crypto`.
//
// Why PBKDF2 in the function instead of `crypt()` in Postgres: `pgcrypto` is
// not installed in this project and we are not adding it for one column. The
// gcal functions already sign state with `crypto.subtle`, so this is the same
// toolbox rather than a new one.
//
// Two different one-way transforms live here and they are NOT interchangeable:
//
//   • PIN -> `hashPin` (PBKDF2-SHA256, 100k iterations, per-row salt). A PIN has
//     at most 10^6 possibilities, so the whole point is to make each guess
//     expensive. The lockout in kid-auth is the real defence; this is the
//     defence-in-depth for a stolen database dump.
//   • Device / invite tokens -> `sha256Hex`. Those are 32 bytes of CSPRNG
//     output, so there is nothing to brute-force and a plain digest is both
//     correct and cheap enough to run on every sign-in. It also gives us a
//     deterministic value we can put a UNIQUE index on and look rows up by.

/** Stored format: `pbkdf2$<iterations>$<saltBase64>$<hashBase64>`. */
const PIN_SCHEME = "pbkdf2";
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = "SHA-256";
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

/** Device tokens: 32 bytes of CSPRNG output, base64url encoded. */
const TOKEN_BYTES = 32;

/**
 * Invite codes. Crockford base32: the ten digits plus the consonants, minus
 * I, L, O and U - so nothing in a printed code can be read two ways, and the
 * one letter that turns short random strings into words is gone too.
 *
 * 32 characters is exactly 5 bits each, so `byte % 32` samples it without bias.
 */
const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 8 characters = 40 bits. Mirrors KID_INVITE_CODE_LENGTH in src/types/kid.ts. */
export const INVITE_CODE_LENGTH = 8;

/**
 * Domain for the synthetic address. `.local` is reserved (RFC 6762) and can
 * never be delivered to, which is exactly what we want: nothing must ever mail
 * a child, and a typo can't turn into a real mailbox somewhere.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "porodica.local";

/** Cap on the readable part of the address - GoTrue accepts far more, but a
 *  long name should not push the whole thing towards the 255-char limit. */
const MAX_EMAIL_LOCAL_BASE = 40;

// ---------------------------------------------------------------------------
// PIN hashing
// ---------------------------------------------------------------------------

/** Derives `pbkdf2$100000$<salt>$<hash>` from a PIN, with a fresh random salt. */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(pin, salt, PBKDF2_ITERATIONS);
  return [PIN_SCHEME, PBKDF2_ITERATIONS, toBase64(salt), toBase64(derived)].join("$");
}

/**
 * True when `pin` reproduces `stored`. The comparison is constant-time so a
 * caller can't learn how many leading bytes it got right from response timing;
 * a malformed or unknown-scheme `stored` value is simply false (never a throw,
 * so a corrupt row degrades to "wrong PIN" instead of a 500).
 *
 * The iteration count is read back from the stored string rather than from the
 * constant above, so raising `PBKDF2_ITERATIONS` later keeps verifying existing
 * hashes instead of locking every child out.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [scheme, iterationsRaw, saltB64, hashB64] = parts;
  if (scheme !== PIN_SCHEME) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(saltB64);
    expected = fromBase64(hashB64);
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await deriveBits(pin, salt, iterations, expected.length * 8);
  return timingSafeEqual(derived, expected);
}

async function deriveBits(
  pin: string,
  salt: Uint8Array,
  iterations: number,
  bits: number = DERIVED_BITS,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: PBKDF2_HASH },
    key,
    bits,
  );
  return new Uint8Array(derived);
}

/** Length-safe, branch-free byte comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * A device token: 32 CSPRNG bytes as base64url, so it survives a URL fragment
 * and a QR code without any escaping.
 */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * An invite code - the credential a parent's QR carries, and the SAME string a
 * child can type instead of scanning.
 *
 * One secret with two delivery routes rather than two secrets, because the
 * routes are not interchangeable on iOS: a home-screen web app has its own
 * storage container and Safari never hands a scanned URL to it, so a child who
 * installs the app has to link a second time from INSIDE it - by scanning with
 * the app's own camera, or by typing this.
 *
 * Short enough for a child to copy off a parent's screen (8 characters, shown
 * as `XXXX-XXXX`) and still 40 bits, against a code that is single use, dies in
 * 15 minutes and is worth nothing without the PIN.
 */
export function randomInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
  return code;
}

/**
 * The form of an invite code we hash and compare - what a child MEANT when they
 * typed it. Upper-cases, drops the separator and anything else that is not in
 * the alphabet, and folds the three shapes Crockford leaves out because they
 * are read wrong: `O` is a zero, `I` and `L` are ones.
 *
 * Mirrored by `normalizeKidInviteCode` in src/types/kid.ts, which the parent's
 * screen and the child's code field both use, and which a test pins to this one.
 */
export function normalizeInviteCode(raw: string): string {
  let out = "";
  for (const char of raw.toUpperCase()) {
    const folded = char === "O" ? "0" : char === "I" || char === "L" ? "1" : char;
    if (INVITE_CODE_ALPHABET.includes(folded)) out += folded;
  }
  return out;
}

/** Lowercase hex SHA-256 - what we store instead of a raw token. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Synthetic address
// ---------------------------------------------------------------------------

/**
 * Builds the address of a child's synthetic auth user, e.g.
 * `mila.jovanovic.3f9a1c07@porodica.local`.
 *
 * Nobody ever sees or types this - it exists only because GoTrue needs an
 * identifier. It still carries the name so a support-shaped look at
 * `auth.users` is readable, and 8 random hex chars so two children with the
 * same name (or a re-enable after a disable) never collide on the UNIQUE index.
 */
export function syntheticEmail(firstName: string | null, lastName: string | null): string {
  const name = [firstName, lastName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  const base = foldToAscii(name)
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, MAX_EMAIL_LOCAL_BASE)
    .replace(/\.+$/, "");
  const local = base === "" ? "dete" : base;
  return `${local}.${randomHex(4)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Serbian latinica -> plain ASCII, lowercased.
 *
 * NFD + stripping combining marks handles c/s/z with a caron or acute, but `đ`
 * is a single precomposed codepoint with no decomposition, so it is mapped by
 * hand - and to `dj`, the way the language actually transliterates it.
 */
function foldToAscii(input: string): string {
  return (
    input
      .replace(/[đĐ]/g, "dj")
      .normalize("NFD")
      // U+0300..U+036F, the combining diacritical marks NFD just split off.
      // Written as escapes because the literals are invisible in an editor.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
  );
}

function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// base64 helpers
// ---------------------------------------------------------------------------
//
// `btoa`/`atob` are global in both Deno and Node 18+, but they speak "binary
// string" rather than bytes, so the two conversions live here once.

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
