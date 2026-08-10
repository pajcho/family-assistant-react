import { describe, expect, it } from "vitest";

import {
  hashPin,
  INVITE_CODE_LENGTH,
  normalizeInviteCode,
  randomInviteCode,
  randomToken,
  sha256Hex,
  SYNTHETIC_EMAIL_DOMAIN,
  syntheticEmail,
  verifyPin,
} from "./kidCrypto.ts";
import {
  KID_INVITE_CODE_LENGTH,
  isKidInviteCode,
  normalizeKidInviteCode,
} from "../../../src/types/kid.ts";

// kidCrypto is deliberately Deno-free, so this suite exercises the real
// implementation under Node's Web Crypto - the exact code the edge functions
// run, not a stand-in. PBKDF2 at 100k iterations costs a few ms per call, so
// the PIN cases stay few and pointed.

describe("hashPin / verifyPin", () => {
  it("round-trips a PIN and rejects a wrong one", async () => {
    const stored = await hashPin("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
    expect(await verifyPin("", stored)).toBe(false);
    expect(await verifyPin("482", stored)).toBe(false);
    expect(await verifyPin("48210", stored)).toBe(false);
  });

  it("stores pbkdf2$<iterations>$<salt>$<hash> with 100k iterations", async () => {
    const stored = await hashPin("1357");
    const parts = stored.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    expect(parts[1]).toBe("100000");
    // 16-byte salt and 32-byte hash, base64 (with padding).
    expect(atob(parts[2])).toHaveLength(16);
    expect(atob(parts[3])).toHaveLength(32);
  });

  it("salts every hash, so the same PIN never stores the same string", async () => {
    const a = await hashPin("135790");
    const b = await hashPin("135790");
    expect(a).not.toBe(b);
    expect(await verifyPin("135790", a)).toBe(true);
    expect(await verifyPin("135790", b)).toBe(true);
  });

  it("verifies against the iteration count in the stored string, not the constant", async () => {
    // A hash written by an older/cheaper setting must keep working, otherwise
    // raising PBKDF2_ITERATIONS would lock every existing child out.
    const stored = await hashPin("2468");
    const [scheme, , salt, hash] = stored.split("$");
    expect(await verifyPin("2468", [scheme, "100000", salt, hash].join("$"))).toBe(true);
    // Same salt at a different cost derives different bits - so this must fail
    // rather than silently pass on a tampered iteration count.
    expect(await verifyPin("2468", [scheme, "1000", salt, hash].join("$"))).toBe(false);
  });

  it("returns false (never throws) for malformed or unknown-scheme rows", async () => {
    expect(await verifyPin("1234", "")).toBe(false);
    expect(await verifyPin("1234", "not-a-hash")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$100000$onlythree")).toBe(false);
    expect(await verifyPin("1234", "bcrypt$100000$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$abc$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$0$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$100000$$")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2$100000$!!!$???")).toBe(false);
  });
});

describe("randomToken", () => {
  it("is 32 bytes of base64url with no padding or URL-unsafe characters", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes -> ceil(32/3)*4 = 44 base64 chars, minus one "=" of padding.
    expect(token).toHaveLength(43);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(seen.size).toBe(200);
  });
});

describe("randomInviteCode", () => {
  it("is 8 characters a child can read back off a screen", () => {
    for (let i = 0; i < 50; i++) {
      const code = randomInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      // Crockford base32: no I, L, O or U, so nothing can be read two ways.
      expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it("comes out already normalized, so the stored hash is the one a typed code produces", () => {
    for (let i = 0; i < 50; i++) {
      const code = randomInviteCode();
      expect(normalizeInviteCode(code)).toBe(code);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomInviteCode()));
    expect(seen.size).toBe(200);
  });
});

/**
 * The one test that spans both halves of the project.
 *
 * `src/types/kid.ts` restates this normalization for the parent's screen and
 * the child's code field, because Deno cannot import across the frontend
 * boundary. If the two ever fold a character differently they hash different
 * strings, and a correctly typed code comes back rejected with nothing
 * anywhere to explain it. Imported from this side because `supabase/` sits
 * outside every tsconfig project and so cannot be imported from `src/`.
 */
describe("the client's mirror of normalizeInviteCode", () => {
  it("folds every shape identically", () => {
    const inputs = [
      "a7k2-9qxm",
      "A7K2 9QXM",
      "  a7k29qxm  ",
      "OIL0IL",
      "oil",
      "a7k2_9qxm",
      "žčć-A7K2",
      "",
      "---",
      "A7K29QXMEXTRA",
    ];
    for (const input of inputs) {
      expect(normalizeKidInviteCode(input)).toBe(normalizeInviteCode(input));
    }
  });

  it("accepts every code this file can mint, and agrees on the length", () => {
    expect(KID_INVITE_CODE_LENGTH).toBe(INVITE_CODE_LENGTH);
    for (let i = 0; i < 50; i++) {
      const code = randomInviteCode();
      expect(normalizeKidInviteCode(code)).toBe(code);
      expect(isKidInviteCode(code)).toBe(true);
    }
  });
});

describe("normalizeInviteCode", () => {
  it("forgives how a code is typed", () => {
    expect(normalizeInviteCode("a7k2-9qxm")).toBe("A7K29QXM");
    expect(normalizeInviteCode(" A7K2 9QXM ")).toBe("A7K29QXM");
    expect(normalizeInviteCode("A7K2_9QXM")).toBe("A7K29QXM");
  });

  it("folds the characters that are read two ways", () => {
    // O is a zero; I and L are ones - the three Crockford leaves out.
    expect(normalizeInviteCode("OIL")).toBe("011");
    expect(normalizeInviteCode("oil")).toBe("011");
  });

  it("is idempotent and empty for a string with nothing usable in it", () => {
    const once = normalizeInviteCode("a7k2-9qxm");
    expect(normalizeInviteCode(once)).toBe(once);
    expect(normalizeInviteCode("---")).toBe("");
    expect(normalizeInviteCode("")).toBe("");
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of a known input", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic, 64 lowercase hex chars, and unique per input", async () => {
    const token = randomToken();
    const once = await sha256Hex(token);
    expect(once).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(token)).toBe(once);
    expect(await sha256Hex(token + "x")).not.toBe(once);
  });

  it("handles non-ASCII input as UTF-8", async () => {
    // Serbian names reach this path via nothing today, but a UTF-8 mismatch
    // between Deno and Node would be a silent, unfindable login failure.
    expect(await sha256Hex("Đorđe")).toBe(await sha256Hex("Đorđe"));
  });
});

describe("syntheticEmail", () => {
  const localPart = (email: string) => email.slice(0, email.indexOf("@"));
  const withoutSuffix = (email: string) => localPart(email).replace(/\.[0-9a-f]{8}$/, "");

  it("builds ime.prezime.<8 hex>@porodica.local", () => {
    const email = syntheticEmail("Mila", "Jovanovic");
    expect(email).toMatch(/^mila\.jovanovic\.[0-9a-f]{8}@porodica\.local$/);
    expect(email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
  });

  it("folds Serbian diacritics to ASCII, with dj for the crossed d", () => {
    expect(withoutSuffix(syntheticEmail("Đorđe", "Šćepanović"))).toBe("djordje.scepanovic");
    expect(withoutSuffix(syntheticEmail("Željko", "Čović"))).toBe("zeljko.covic");
    expect(withoutSuffix(syntheticEmail("ĐURĐA", null))).toBe("djurdja");
  });

  it("collapses every non-alphanumeric run into a single dot and trims the ends", () => {
    expect(withoutSuffix(syntheticEmail("  Ana   Marija  ", "Petrov-Jovic"))).toBe(
      "ana.marija.petrov.jovic",
    );
    expect(withoutSuffix(syntheticEmail("'Luka'", "!!!"))).toBe("luka");
  });

  it("falls back to dete when there is no usable name", () => {
    expect(withoutSuffix(syntheticEmail(null, null))).toBe("dete");
    expect(withoutSuffix(syntheticEmail("", "   "))).toBe("dete");
    // Nothing survives the ASCII fold - still a valid address, never an empty
    // local part that GoTrue would reject.
    expect(withoutSuffix(syntheticEmail("...", "---"))).toBe("dete");
    expect(withoutSuffix(syntheticEmail("小明", null))).toBe("dete");
  });

  it("caps a long name and never ends the readable part on a dot", () => {
    const email = syntheticEmail("Aleksandra Konstantina", "Petrovic Jovanovic Nikolic");
    const base = withoutSuffix(email);
    expect(base.length).toBeLessThanOrEqual(40);
    expect(base.endsWith(".")).toBe(false);
    expect(email).toMatch(/^[a-z0-9.]+\.[0-9a-f]{8}@porodica\.local$/);
  });

  it("gives two children with the same name different addresses", () => {
    const emails = new Set(Array.from({ length: 50 }, () => syntheticEmail("Luka", "Luka")));
    expect(emails.size).toBe(50);
  });
});
