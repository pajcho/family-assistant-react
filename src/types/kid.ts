/**
 * Shared contract for the kid mode (decji rezim): a separate, read-only shell
 * for children who sign in with a device link + PIN instead of an email.
 *
 * The whole security model in one paragraph: a kid's Supabase auth user is
 * SYNTHETIC - it has a generated address nobody ever sees, no password at all,
 * and crucially NO row in `profiles`. Since every pre-existing RLS policy
 * resolves the caller through `profiles WHERE id = auth.uid()`, a kid session
 * matches nothing by default. Access is then granted back, table by table, by
 * narrow SELECT-only policies keyed on `public.kid_profile_id()`. A table we
 * forget is invisible to kids, never leaked to them.
 *
 * `kid_access.profile_id` stays the child's ORIGINAL profile id (unlike
 * `manage-family-login`, which re-keys the profile to the new auth user). The
 * link between the two lives only in `kid_access.auth_user_id`.
 */

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Is this router pathname a screen a CHILD is looking at?
 *
 * `/kid/preview` is not: that is a parent previewing their child's app from
 * their own session, so anything addressed to a child (kid-worded copy, the
 * kid install identity) has no business appearing there.
 *
 * `src/lib/kidInstallIdentity.ts` asks the same question and deliberately does
 * not call this - it is stringified into `index.html`, so it may not reference
 * anything outside its own body.
 */
export function isKidShellPath(pathname: string): boolean {
  const inShell = pathname === "/kid" || pathname.startsWith("/kid/");
  return inShell && !pathname.startsWith("/kid/preview");
}

// ---------------------------------------------------------------------------
// Themes - the only thing a kid can change about the app
// ---------------------------------------------------------------------------

/** DB-stored theme keys. English in the database, Serbian only in labels. */
export const KID_THEME_KEYS = [
  "ocean",
  "jungle",
  "sun",
  "candy",
  "watermelon",
  "lavender",
  "pearl",
  "space",
] as const;
export type KidTheme = (typeof KID_THEME_KEYS)[number];

export const DEFAULT_KID_THEME: KidTheme = "ocean";

export interface KidThemeOption {
  key: KidTheme;
  label: string;
  emoji: string;
  /** Inline CSS gradient for the swatch - matches --k-grad in styles/kid.css. */
  swatch: string;
  /** True for the one dark theme, so the picker can group it. */
  dark?: boolean;
}

export const KID_THEME_OPTIONS: readonly KidThemeOption[] = [
  { key: "ocean", label: "Okean", emoji: "🌊", swatch: "linear-gradient(135deg,#41b7f0,#3163e9)" },
  {
    key: "jungle",
    label: "Džungla",
    emoji: "🌿",
    swatch: "linear-gradient(135deg,#43c06e,#0e8c5b)",
  },
  { key: "sun", label: "Sunce", emoji: "☀️", swatch: "linear-gradient(135deg,#ffc53d,#f4741f)" },
  {
    key: "candy",
    label: "Slatkiš",
    emoji: "🍭",
    swatch: "linear-gradient(135deg,#f675b4,#d9367c)",
  },
  {
    key: "watermelon",
    label: "Lubenica",
    emoji: "🍉",
    swatch: "linear-gradient(135deg,#ff6b7a,#e8264f)",
  },
  {
    key: "lavender",
    label: "Lavanda",
    emoji: "🌸",
    swatch: "linear-gradient(135deg,#b096e6,#7d5fd0)",
  },
  {
    key: "pearl",
    label: "Biser",
    emoji: "🐚",
    swatch: "linear-gradient(135deg,#c98ba3,#9789c6,#6b9fba)",
  },
  {
    key: "space",
    label: "Svemir",
    emoji: "🚀",
    swatch: "linear-gradient(135deg,#5b5be0,#9d4ee8)",
    dark: true,
  },
];

export function normalizeKidTheme(raw: string | null | undefined): KidTheme {
  return KID_THEME_KEYS.includes(raw as KidTheme) ? (raw as KidTheme) : DEFAULT_KID_THEME;
}

// ---------------------------------------------------------------------------
// PIN rules
// ---------------------------------------------------------------------------

/** A PIN is 4 or 6 digits - long enough behind a device token + lockout. */
export const KID_PIN_LENGTHS = [4, 6] as const;

export function isValidKidPin(pin: string): boolean {
  return /^\d+$/.test(pin) && (KID_PIN_LENGTHS as readonly number[]).includes(pin.length);
}

/** Failed PIN attempts before the account locks (mirrored server-side). */
export const KID_MAX_PIN_ATTEMPTS = 5;

/** How long a device-link invite stays valid, in minutes (mirrored server-side). */
export const KID_INVITE_TTL_MINUTES = 15;

// ---------------------------------------------------------------------------
// JWT claims - how the client knows a session is a kid session
// ---------------------------------------------------------------------------

/**
 * Written into the synthetic auth user's `app_metadata` at provision time, so
 * routing decisions need zero round trips. NOT a security boundary: RLS is,
 * and it re-checks `is_enabled` on every query, so a child whose access was
 * turned OFF sees nothing from the very next request even while holding a
 * valid JWT.
 *
 * Revoking one DEVICE is the softer case - `is_enabled` is untouched, so RLS
 * keeps answering - which is why `kid-access` ends the child's sessions
 * server-side (no more refreshes) and the shell probes `kid-auth`'s `check`
 * to close the gap left by the current access token, which stays valid until
 * it expires.
 */
export interface KidClaims {
  kid: true;
  kid_profile_id: string;
  family_id: string;
}

export function readKidClaims(appMetadata: unknown): KidClaims | null {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const meta = appMetadata as Record<string, unknown>;
  if (meta.kid !== true) return null;
  const profileId = meta.kid_profile_id;
  const familyId = meta.family_id;
  if (typeof profileId !== "string" || typeof familyId !== "string") return null;
  return { kid: true, kid_profile_id: profileId, family_id: familyId };
}

// ---------------------------------------------------------------------------
// Locally remembered devices - the "Ko si ti?" picker
// ---------------------------------------------------------------------------

/**
 * localStorage key holding `KidDeviceEntry[]`. This list is the ONLY source for
 * the profile picker on the login screen: it is never fetched from the server,
 * so a stranger opening the app on an unknown device cannot learn the family's
 * children (how many, or their names).
 */
export const KID_DEVICES_STORAGE_KEY = "kid-devices";

export interface KidDeviceEntry {
  profileId: string;
  /** First name, cached at claim time purely to label the picker button. */
  name: string;
  /** Bearer credential proving this device was linked by a parent. */
  deviceToken: string;
  theme: KidTheme;
  color: string | null;
  /**
   * Cached with the name for the same reason: the picker runs before any
   * session, so it can only render what this device already knows. Refreshed
   * on every sign-in, so a parent's change shows up the next time.
   *
   * Optional because entries written before this field existed are still in
   * localStorage and stay valid - they simply fall back to the automatic
   * animal until that child signs in once more.
   */
  emoji?: string | null;
}

// ---------------------------------------------------------------------------
// Edge function contracts
// ---------------------------------------------------------------------------

/** Public profile summary a kid endpoint may return before a session exists. */
export interface KidProfileSummary {
  id: string;
  name: string;
  theme: KidTheme;
  color: string | null;
  /** The avatar a parent picked for this child, or null for the automatic one. */
  emoji: string | null;
}

/**
 * `kid-auth` - called WITHOUT a session (verify_jwt = false), except `check`,
 * which a signed-in child's app asks in the background: "is this device still
 * allowed in?". It carries no PIN, costs no lockout attempt, and answers only
 * `{ ok: true }` or one of `device_unknown` / `access_disabled`.
 */
export type KidAuthRequest =
  | { action: "claim"; token: string; pin: string }
  | { action: "login"; deviceToken: string; pin: string }
  | { action: "check"; deviceToken: string };

export interface KidAuthResponse {
  /**
   * Single-use `token_hash` from `auth.admin.generateLink`. The client turns it
   * into a real session with
   * `supabase.auth.verifyOtp({ token_hash: sessionToken, type: "magiclink" })`.
   */
  sessionToken: string;
  profile: KidProfileSummary;
  /** Only on `claim` - store it in `KID_DEVICES_STORAGE_KEY`. */
  deviceToken?: string;
}

/**
 * The two `check` verdicts the kid shell acts on, and the ONLY reasons it ever
 * signs a child out by itself. Anything else (offline, 500, unparsable) is
 * treated as "no answer" and changes nothing - a child on a flaky connection
 * must not be thrown out of their own app.
 */
export type KidAccessRevokedReason = "device_unknown" | "access_disabled";

/** Machine-readable failures; the `error` field carries the Serbian message. */
export type KidAuthErrorCode =
  | "invalid_pin"
  | "locked"
  | "invite_invalid"
  | "invite_expired"
  | "invite_used"
  | "device_unknown"
  | "access_disabled";

export interface KidAuthErrorBody {
  error: string;
  code: KidAuthErrorCode;
  /** On `invalid_pin`. */
  attemptsLeft?: number;
  /** On `locked`. */
  retryAfterSeconds?: number;
}

/** `kid-access` - parent-side management, admin only (verify_jwt = true). */
export type KidAccessRequest =
  | { action: "enable"; profileId: string; pin: string }
  | { action: "disable"; profileId: string }
  | { action: "set-pin"; profileId: string; pin: string }
  | { action: "invite"; profileId: string }
  | { action: "revoke-device"; deviceId: string };

export interface KidInviteResponse {
  /**
   * The raw invite code - shown once, as a QR code AND as eight readable
   * characters. Only its hash is stored. See `randomInviteCode` in
   * supabase/functions/_shared/kidCrypto.ts for why one string does both jobs.
   */
  token: string;
  expiresAt: string;
}

/**
 * Builds the device-link URL a parent shows as a QR code. The token rides in
 * the URL FRAGMENT so it never reaches a server log, proxy, or Referer header.
 */
export function kidInviteUrl(token: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/kid/link#${token}`;
}

// ---------------------------------------------------------------------------
// Invite codes - the typed half of device linking
// ---------------------------------------------------------------------------
//
// A child cannot always scan. On iOS a home-screen web app has its own storage
// container and Safari never hands a scanned URL to it, so linking has to be
// possible from INSIDE the installed app: with its own camera, or by typing the
// code off the parent's screen. Both paths end at the same string.
//
// The three helpers below MIRROR `randomInviteCode` / `normalizeInviteCode` in
// supabase/functions/_shared/kidCrypto.ts. They are restated rather than
// imported because Deno cannot reach across the frontend boundary; a test
// (src/types/__tests__/kid.test.ts) imports both and pins them to each other.

/** Characters in a code: Crockford base32 (no I, L, O, U). */
const KID_INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How many of them. Mirrors INVITE_CODE_LENGTH server-side. */
export const KID_INVITE_CODE_LENGTH = 8;

/** Where the `-` goes in the displayed form: `XXXX-XXXX`. */
const KID_INVITE_CODE_GROUP = 4;

/**
 * What a child MEANT when they typed a code: upper-cased, separators and typos
 * dropped, and the three characters that are read two ways folded the way
 * Crockford does it - `O` is a zero, `I` and `L` are ones.
 */
export function normalizeKidInviteCode(raw: string): string {
  let out = "";
  for (const char of raw.toUpperCase()) {
    const folded = char === "O" ? "0" : char === "I" || char === "L" ? "1" : char;
    if (KID_INVITE_CODE_ALPHABET.includes(folded)) out += folded;
  }
  return out;
}

/** True when `value` is already a complete, normalized code. */
export function isKidInviteCode(value: string): boolean {
  return value.length === KID_INVITE_CODE_LENGTH && normalizeKidInviteCode(value) === value;
}

/** `A7K29QXM` -> `A7K2-9QXM`, the only form ever shown to a human. */
export function formatKidInviteCode(code: string): string {
  const normalized = normalizeKidInviteCode(code);
  if (normalized.length <= KID_INVITE_CODE_GROUP) return normalized;
  return `${normalized.slice(0, KID_INVITE_CODE_GROUP)}-${normalized.slice(KID_INVITE_CODE_GROUP)}`;
}

/**
 * The invite token inside something a camera just read, or null when the QR was
 * simply not ours (a bus ticket, a wifi code, a fiscal receipt).
 *
 * Accepts both shapes on purpose: the full `.../kid/link#<code>` URL a parent's
 * screen shows, and a bare code, so a code written on paper scans too. A URL's
 * fragment is passed through WITHOUT the length check - an older parent app may
 * still be minting 32-byte tokens, and the server can decide about those.
 */
export function kidInviteTokenFromScan(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (!url.pathname.replace(/\/+$/, "").endsWith("/kid/link")) return null;
    let token = url.hash.replace(/^#/, "").trim();
    try {
      token = decodeURIComponent(token);
    } catch {
      /* not percent-encoded - use it as it came */
    }
    return token || null;
  }

  const code = normalizeKidInviteCode(value);
  return isKidInviteCode(code) ? code : null;
}
